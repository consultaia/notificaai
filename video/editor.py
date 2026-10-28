#!/usr/bin/env python3
"""
Editor de video do NotificaAI — transforma gravacoes brutas em video pronto para
YouTube (horizontal 1920x1080) e Reels/status (vertical 1080x1920).

O que faz, para cada bloco gravado:
  1. limpa o audio (filtros de voz + reducao de ruido) e corta pausas, respiros,
     inicio e fim mortos (deteccao de silencio);
  2. enquadra no formato (corte central ou fundo desfocado quando a proporcao nao bate);
  3. aplica zoom nos momentos-chave (troca a cada frase, como "punch-in");
  4. encaixa cenas de apoio (b-roll) por cima, mantendo a voz;
  5. legenda: palavra por palavra com transcricao (faster-whisper, se disponivel)
     ou distribuida sobre a fala a partir do texto do roteiro;
depois junta tudo com abertura, nome/cargo na tela, encerramento com QR code,
trilha com "ducking" (abaixa quando ha fala), efeitos sonoros discretos,
volume padrao de streaming (-14 LUFS) e gera capa e legenda .srt.

Uso:
  python3 video/editor.py video/projetos/exemplo-quedas.json
  python3 video/editor.py projeto.json --formatos vertical --rapido

Requisitos: ffmpeg, Pillow, segno. Opcional: faster-whisper + acesso a huggingface.co.
"""
import argparse, json, math, os, re, shutil, subprocess, sys, tempfile, textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONTES = Path('/usr/share/fonts/opentype/inter')
FPS = 30
FORMATOS = {'horizontal': (1920, 1080), 'vertical': (1080, 1920)}
ESTILOS = {
    # institucional: sobrio (legenda branca em faixa escura, zoom leve)
    'institucional': dict(zoom=1.05, palavras=7, sfx=False, legenda_cor='&H00FFFFFF', destaque='&H0000D4FF', caixa=True),
    # reels: dinamico (legenda amarela grande no centro, zoom marcado, efeitos sonoros)
    'reels': dict(zoom=1.12, palavras=3, sfx=True, legenda_cor='&H00FFFFFF', destaque='&H0000D4FF', caixa=False),
}


def log(*a):
    print('[editor]', *a, flush=True)


def run(cmd, quiet=True):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr[-4000:])
        raise RuntimeError('falhou: ' + ' '.join(map(str, cmd[:6])) + ' ...')
    return r


def probe(path):
    r = run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height:stream_side_data=rotation',
             '-of', 'json', str(path)])
    d = json.loads(r.stdout)
    v = next((s for s in d.get('streams', []) if s.get('codec_type') == 'video'), None)
    a = any(s.get('codec_type') == 'audio' for s in d.get('streams', []))
    w, h = (v or {}).get('width', 0), (v or {}).get('height', 0)
    rot = 0
    for sd in (v or {}).get('side_data_list', []) or []:
        if 'rotation' in sd:
            rot = int(sd['rotation'])
    if abs(rot) in (90, 270):
        w, h = h, w
    return dict(dur=float(d['format']['duration']), w=w, h=h, audio=a)


def fonte(peso, tam):
    nome = {'regular': 'Inter-Regular.otf', 'medium': 'Inter-Medium.otf', 'semibold': 'Inter-SemiBold.otf',
            'bold': 'Inter-Bold.otf', 'extrabold': 'Inter-ExtraBold.otf', 'black': 'Inter-Black.otf'}[peso]
    return ImageFont.truetype(str(FONTES / nome), tam)


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def ass_cor(hexcor, alpha=0):
    r, g, b = hex_rgb(hexcor)
    return '&H%02X%02X%02X%02X' % (alpha, b, g, r)


# ── audio: silencio / fala ────────────────────────────────────────────────────
FILTRO_VOZ = 'highpass=f=80,lowpass=f=12000,afftdn=nf=-25,acompressor=threshold=-21dB:ratio=3:attack=5:release=120:makeup=2'


def detectar_silencios(path, ruido_db, minimo):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(path), '-af', f'{FILTRO_VOZ},silencedetect=noise={ruido_db}dB:d={minimo}',
                        '-f', 'null', '-'], capture_output=True, text=True)
    sil, ini = [], None
    for ln in r.stderr.splitlines():
        m = re.search(r'silence_start: ([\d.]+)', ln)
        if m:
            ini = float(m.group(1))
        m = re.search(r'silence_end: ([\d.]+)', ln)
        if m and ini is not None:
            sil.append((ini, float(m.group(1))))
            ini = None
    if ini is not None:
        sil.append((ini, 1e9))
    return sil


def nivel_medio(path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(path), '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True)
    m = re.search(r'mean_volume: (-?[\d.]+) dB', r.stderr)
    return float(m.group(1)) if m else -30.0


def intervalos_fala(dur, sil):
    falas, t = [], 0.0
    for a, b in sil:
        if a > t:
            falas.append((t, min(a, dur)))
        t = max(t, b)
    if t < dur:
        falas.append((t, dur))
    return [(a, b) for a, b in falas if b - a > 0.12]


def manter(falas, dur, pad, pausa):
    """Trechos a manter: cada fala com uma folga; pausas longas viram 'pausa' segundos."""
    if not falas:
        return [(0, dur)]
    seg = []
    for a, b in falas:
        a2, b2 = max(0, a - pad), min(dur, b + pad)
        if seg and a2 - seg[-1][1] < pausa:
            seg[-1] = (seg[-1][0], b2)
        else:
            seg.append((a2, b2))
    return seg


def mapear(t, seg):
    """Tempo original -> tempo apos os cortes."""
    acc = 0.0
    for a, b in seg:
        if t <= a:
            return acc
        if t <= b:
            return acc + (t - a)
        acc += b - a
    return acc


# ── transcricao (opcional) ────────────────────────────────────────────────────
_modelo = None


def transcrever(path, modelo):
    global _modelo
    try:
        from faster_whisper import WhisperModel
    except Exception:
        return None
    try:
        if _modelo is None:
            log('carregando modelo de transcricao', modelo)
            _modelo = WhisperModel(modelo, device='cpu', compute_type='int8')
        segs, _ = _modelo.transcribe(str(path), language='pt', word_timestamps=True, vad_filter=True)
        palavras = []
        for s in segs:
            for w in s.words or []:
                palavras.append((w.start, w.end, w.word.strip()))
        return palavras or None
    except Exception as e:
        log('transcricao indisponivel (' + str(e)[:80] + ') — usando o texto do roteiro')
        return None


# ── legenda ───────────────────────────────────────────────────────────────────
def pedacos_texto(texto, max_palavras):
    frases = re.split(r'(?<=[.!?…])\s+', texto.strip())
    out = []
    for f in frases:
        ws = f.split()
        if not ws:
            continue
        n = max(1, math.ceil(len(ws) / max_palavras))
        tam = math.ceil(len(ws) / n)
        for i in range(0, len(ws), tam):
            out.append((' '.join(ws[i:i + tam]), i + tam >= len(ws)))
    return out  # (texto, fim_de_frase)


def legendas_por_roteiro(texto, falas_cortadas, max_palavras):
    """Distribui os pedacos do roteiro sobre os intervalos de fala, proporcional ao numero de letras."""
    peds = pedacos_texto(texto, max_palavras)
    if not peds or not falas_cortadas:
        return []
    total_fala = sum(b - a for a, b in falas_cortadas)
    total_chars = sum(len(p) + 2 for p, _ in peds)

    def real(st):
        acc = 0.0
        for a, b in falas_cortadas:
            if st <= acc + (b - a):
                return a + (st - acc)
            acc += b - a
        return falas_cortadas[-1][1]
    ev, st = [], 0.0
    for p, fim in peds:
        d = total_fala * (len(p) + 2) / total_chars
        ev.append([real(st), real(st + d), p, fim])
        st += d
    for i in range(len(ev) - 1):  # sem buracos curtos entre legendas
        if ev[i + 1][0] - ev[i][1] < 0.6:
            ev[i][1] = ev[i + 1][0]
    return ev


def legendas_por_palavras(palavras, max_palavras):
    ev, grupo = [], []
    for w in palavras:
        grupo.append(w)
        fim = bool(re.search(r'[.!?…]$', w[2]))
        if len(grupo) >= max_palavras or fim:
            ev.append([grupo[0][0], grupo[-1][1], ' '.join(x[2] for x in grupo), fim])
            grupo = []
    if grupo:
        ev.append([grupo[0][0], grupo[-1][1], ' '.join(x[2] for x in grupo), True])
    for i in range(len(ev) - 1):
        if ev[i + 1][0] - ev[i][1] < 0.6:
            ev[i][1] = ev[i + 1][0]
    return ev


def ts_ass(t):
    t = max(0, t)
    h, m, s = int(t // 3600), int(t % 3600 // 60), t % 60
    return f'{h}:{m:02d}:{s:05.2f}'


def ts_srt(t):
    t = max(0, t)
    h, m, s, ms = int(t // 3600), int(t % 3600 // 60), int(t % 60), int(round((t - int(t)) * 1000)) % 1000
    return f'{h:02d}:{m:02d}:{s:02d},{ms:03d}'


def escrever_ass(caminho, W, H, eventos, estilo, cfg, lower):
    e = ESTILOS[estilo]
    vert = H > W
    if estilo == 'reels':
        tam, marg, al = (86 if vert else 72), (int(H * 0.30) if vert else 110), 2
        st = f'Style: Leg,Inter Black,{tam},{e["legenda_cor"]},&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,2,{al},60,60,{marg},1'
    else:
        tam, marg = (58 if vert else 50), (int(H * 0.20) if vert else 70)
        st = f'Style: Leg,Inter SemiBold,{tam},&H00FFFFFF,&H000000FF,&H8C0E1A26,&H8C0E1A26,0,0,0,0,100,100,0,0,3,14,0,2,80,80,{marg},1'
    cor = ass_cor(cfg.get('cor', '#0D9488'))
    nome_tam, cargo_tam = (56, 40) if vert else (46, 32)
    ly = int(H * (0.755 if vert else 0.72))
    linhas = ['[Script Info]', 'ScriptType: v4.00+', f'PlayResX: {W}', f'PlayResY: {H}', 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
              '[V4+ Styles]',
              'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
              st,
              f'Style: Nome,Inter ExtraBold,{nome_tam},&H00FFFFFF,&H000000FF,{cor},{cor},0,0,0,0,100,100,0,0,3,18,0,1,70,70,0,1',
              f'Style: Cargo,Inter Medium,{cargo_tam},&H00222222,&H000000FF,&H00FFFFFF,&H00FFFFFF,0,0,0,0,100,100,0,0,3,12,0,1,70,70,0,1',
              '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
    for a, b, txt, _ in eventos:
        t = txt.replace('{', '(').replace('}', ')')
        if estilo == 'reels':
            # entrada com leve "pop" e palavra mais longa destacada em amarelo
            ws = t.split()
            if ws:
                k = max(range(len(ws)), key=lambda i: len(re.sub(r'\W', '', ws[i])))
                ws[k] = '{\\c' + e['destaque'] + '}' + ws[k] + '{\\c' + e['legenda_cor'] + '}'
            t = '{\\fscx85\\fscy85\\t(0,90,\\fscx100\\fscy100)}' + ' '.join(ws)
        linhas.append(f'Dialogue: 0,{ts_ass(a)},{ts_ass(b)},Leg,,0,0,0,,{t}')
    if lower:
        a, b, nome, cargo = lower
        x = 70
        linhas.append(f'Dialogue: 1,{ts_ass(a)},{ts_ass(b)},Nome,,0,0,0,,{{\\pos({x},{ly})\\an1\\fad(250,250)}}{nome}')
        linhas.append(f'Dialogue: 1,{ts_ass(a + 0.15)},{ts_ass(b)},Cargo,,0,0,0,,{{\\pos({x},{ly + int(nome_tam * 1.55)})\\an1\\fad(250,250)}}{cargo}')
    Path(caminho).write_text('\n'.join(linhas) + '\n', encoding='utf-8')


def escrever_srt(caminho, eventos):
    out = []
    for i, (a, b, t, _) in enumerate(eventos, 1):
        out += [str(i), f'{ts_srt(a)} --> {ts_srt(b)}', t, '']
    Path(caminho).write_text('\n'.join(out), encoding='utf-8')


# ── cartelas (abertura, encerramento, capa) ───────────────────────────────────
def gradiente(W, H, c1, c2):
    img = Image.new('RGB', (W, H), c1)
    top, bot = hex_rgb(c1), hex_rgb(c2)
    px = img.load()
    for y in range(H):
        f = y / max(1, H - 1)
        cor = tuple(int(top[i] * (1 - f) + bot[i] * f) for i in range(3))
        for x in range(W):
            px[x, y] = cor
    return img


def texto_quebrado(d, txt, fnt, largura):
    palavras, linhas, atual = txt.split(), [], ''
    for p in palavras:
        teste = (atual + ' ' + p).strip()
        if d.textlength(teste, font=fnt) <= largura:
            atual = teste
        else:
            if atual:
                linhas.append(atual)
            atual = p
    if atual:
        linhas.append(atual)
    return linhas


def cartela_abertura(caminho, W, H, cfg):
    img = gradiente(W, H, cfg.get('cor_fundo', '#06101F'), cfg.get('cor_fundo2', '#0D3B66'))
    d = ImageDraw.Draw(img)
    vert = H > W
    s = W / 1920 if not vert else W / 1080
    cor = hex_rgb(cfg.get('cor', '#0D9488'))
    destaque = hex_rgb(cfg.get('cor_destaque', '#FFD400'))
    marg = int(120 * s)
    y = int(H * (0.32 if vert else 0.28))
    if cfg.get('logo') and Path(cfg['logo']).exists():
        lg = Image.open(cfg['logo']).convert('RGBA')
        alt = int((180 if vert else 150) * s)
        lg = lg.resize((int(lg.width * alt / lg.height), alt))
        img.paste(lg, (marg, y - alt - int(40 * s)), lg)
    f1 = fonte('bold', int((44 if vert else 40) * s))
    d.text((marg, y), (cfg.get('rotulo') or 'Segurança do paciente').upper(), font=f1, fill=cor)
    y += int((84 if vert else 76) * s)
    ft = fonte('black', int((132 if vert else 150) * s))
    for ln in texto_quebrado(d, cfg['titulo'], ft, W - 2 * marg):
        d.text((marg, y), ln, font=ft, fill=(255, 255, 255))
        y += int(ft.size * 1.08)
    d.rectangle([marg, y + int(26 * s), marg + int(150 * s), y + int(40 * s)], fill=destaque)
    y += int(80 * s)
    if cfg.get('subtitulo'):
        fs = fonte('medium', int((54 if vert else 54) * s))
        for ln in texto_quebrado(d, cfg['subtitulo'], fs, W - 2 * marg):
            d.text((marg, y), ln, font=fs, fill=(200, 216, 232))
            y += int(fs.size * 1.35)
    fi = fonte('semibold', int((34 if vert else 28) * s))
    d.text((marg, H - int(150 * s)), cfg.get('instituicao', ''), font=fi, fill=(160, 180, 200))
    img.save(caminho)


def cartela_final(caminho, W, H, cfg):
    import segno
    img = gradiente(W, H, cfg.get('cor_fundo', '#06101F'), cfg.get('cor_fundo2', '#0D3B66'))
    d = ImageDraw.Draw(img)
    vert = H > W
    s = W / 1920 if not vert else W / 1080
    destaque = hex_rgb(cfg.get('cor_destaque', '#FFD400'))
    qrtam = int((560 if vert else 420) * s)
    q = segno.make(cfg.get('qr', 'https://' + cfg.get('link', 'notificaai.ia.br')), error='m')
    tmp = Path(caminho).with_suffix('.qr.png')
    q.save(str(tmp), scale=20, border=2, dark='#06101F')
    qr = Image.open(tmp).convert('RGB').resize((qrtam, qrtam), Image.NEAREST)
    tmp.unlink()
    chamada = cfg.get('chamada_final', 'Viu algo errado? Notifique.')
    fc = fonte('black', int((84 if vert else 76) * s))
    fl = fonte('extrabold', int((56 if vert else 50) * s))
    fi = fonte('semibold', int((32 if vert else 28) * s))
    if vert:
        y = int(H * 0.16)
        for ln in texto_quebrado(d, chamada, fc, W - 160):
            d.text(((W - d.textlength(ln, font=fc)) / 2, y), ln, font=fc, fill=(255, 255, 255))
            y += int(fc.size * 1.1)
        y += int(60 * s)
        x = (W - qrtam) // 2
        d.rounded_rectangle([x - 24, y - 24, x + qrtam + 24, y + qrtam + 24], radius=36, fill=destaque)
        img.paste(qr, (x, y))
        y += qrtam + int(90 * s)
        lk = cfg.get('link', '')
        d.text(((W - d.textlength(lk, font=fl)) / 2, y), lk, font=fl, fill=destaque)
        inst = cfg.get('instituicao', '')
        d.text(((W - d.textlength(inst, font=fi)) / 2, H - int(170 * s)), inst, font=fi, fill=(170, 190, 210))
    else:
        marg = int(140 * s)
        y = int(H * 0.28)
        for ln in texto_quebrado(d, chamada, fc, W - qrtam - 3 * marg):
            d.text((marg, y), ln, font=fc, fill=(255, 255, 255))
            y += int(fc.size * 1.1)
        y += int(40 * s)
        d.text((marg, y), cfg.get('link', ''), font=fl, fill=destaque)
        d.text((marg, H - int(130 * s)), cfg.get('instituicao', ''), font=fi, fill=(170, 190, 210))
        x, yq = W - marg - qrtam, (H - qrtam) // 2
        d.rounded_rectangle([x - 22, yq - 22, x + qrtam + 22, yq + qrtam + 22], radius=34, fill=destaque)
        img.paste(qr, (x, yq))
    img.save(caminho)


def capa(caminho, quadro, cfg):
    W, H = 1280, 720
    base = Image.open(quadro).convert('RGB')
    r = max(W / base.width, H / base.height)
    base = base.resize((int(base.width * r), int(base.height * r)))
    base = base.crop(((base.width - W) // 2, (base.height - H) // 2, (base.width - W) // 2 + W, (base.height - H) // 2 + H))
    img = base.copy()
    sombra = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ds = ImageDraw.Draw(sombra)
    for x in range(W):
        a = int(235 * max(0, 1 - x / (W * 0.62)))
        ds.line([(x, 0), (x, H)], fill=(6, 16, 31, a))
    img = Image.alpha_composite(img.convert('RGBA'), sombra)
    d = ImageDraw.Draw(img)
    destaque = hex_rgb(cfg.get('cor_destaque', '#FFD400'))
    titulo = cfg.get('titulo_capa') or cfg['titulo']
    ft = fonte('black', 92)
    y = 150
    for i, ln in enumerate(texto_quebrado(d, titulo.upper(), ft, int(W * 0.56))):
        d.text((64, y), ln, font=ft, fill=destaque if i == 0 else (255, 255, 255), stroke_width=4, stroke_fill=(6, 16, 31))
        y += 100
    fi = fonte('bold', 30)
    d.rounded_rectangle([64, H - 110, 64 + d.textlength(cfg.get('selo', 'SEGURANÇA DO PACIENTE'), font=fi) + 40, H - 58], radius=10, fill=hex_rgb(cfg.get('cor', '#0D9488')))
    d.text((84, H - 104), cfg.get('selo', 'SEGURANÇA DO PACIENTE'), font=fi, fill=(255, 255, 255))
    img.convert('RGB').save(caminho, quality=92)


# ── video ─────────────────────────────────────────────────────────────────────
VENC = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', str(FPS),
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2']


def enquadrar(W, H, iw, ih, p='e'):
    """Filtro para levar a entrada ao formato: corte central se a proporcao for parecida,
    senao video inteiro sobre fundo desfocado."""
    ri, ro = iw / max(1, ih), W / H
    if abs(ri - ro) / ro < 0.35 or (ro < 1 and ri > 1):  # horizontal -> vertical: corta o centro
        return f'scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}', False
    return (f'split[{p}a][{p}b];[{p}a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=40:2,eq=brightness=-0.08[{p}bg];'
            f'[{p}b]scale={W}:{H}:force_original_aspect_ratio=decrease[{p}fg];[{p}bg][{p}fg]overlay=(W-w)/2:(H-h)/2'), True


def expr_zoom(fases, z):
    """Zoom que alterna a cada frase: 1.0 / z / 1.0 ... (corte seco, estilo 'punch-in')."""
    if not fases:
        return '1'
    e = '1'
    for i, (a, b) in enumerate(fases):
        if i % 2 == 1:
            e = f'if(between(t,{a:.3f},{b:.3f}),{z},{e})'
    return e


def processar_bloco(i, bloco, pasta_proj, W, H, estilo, cfg, tmp, args):
    src = (pasta_proj / bloco['arquivo']).resolve()
    if not src.exists():
        raise FileNotFoundError(f'bloco {i + 1}: arquivo nao encontrado: {src}')
    info = probe(src)
    if not info['audio']:
        raise RuntimeError(f'bloco {i + 1}: o video nao tem audio ({src.name}). Grave com o microfone ligado.')
    nivel = nivel_medio(src)
    if nivel < -70:
        raise RuntimeError(f'bloco {i + 1}: o audio esta mudo ({nivel:.0f} dB). Confira se a gravacao captou som.')
    ruido = cfg.get('ruido_db') or max(-50, min(-28, round(nivel - 12)))
    sil = detectar_silencios(src, ruido, cfg.get('silencio_min', 0.35))
    falas = intervalos_fala(info['dur'], sil)
    seg = manter(falas, info['dur'], cfg.get('folga', 0.12), cfg.get('pausa_max', 0.30)) if bloco.get('cortar', True) else [(0, info['dur'])]
    dur_corte = sum(b - a for a, b in seg)
    falas_c = [(mapear(a, seg), mapear(b, seg)) for a, b in falas]
    sel = '+'.join(f'between(t,{a:.3f},{b:.3f})' for a, b in seg)
    filtro_enq, desfocado = enquadrar(W, H, info['w'], info['h'], 'm')

    # legendas do bloco (tempo ja cortado)
    e = ESTILOS[estilo]
    cortado_audio = tmp / f'b{i}_audio.wav'
    run(['ffmpeg', '-y', '-v', 'error', '-i', str(src), '-af', f"{FILTRO_VOZ},aselect='{sel}',asetpts=N/SR/TB", '-ar', '16000', '-ac', '1', str(cortado_audio)])
    palavras = transcrever(cortado_audio, args.modelo) if not args.sem_transcricao else None
    if palavras:
        eventos, metodo = legendas_por_palavras(palavras, e['palavras']), 'transcrição'
    else:
        eventos, metodo = legendas_por_roteiro(bloco.get('texto', ''), falas_c, e['palavras']), 'roteiro'
    if bloco.get('sem_legenda'):
        eventos = []
    # zoom troca a cada frase
    fases, ini = [], 0.0
    for ev in eventos:
        if ev[3]:
            fases.append((ini, ev[1]))
            ini = ev[1]
    if ini < dur_corte:
        fases.append((ini, dur_corte + 1))
    z = 1 if (desfocado or bloco.get('sem_zoom')) else e['zoom']
    zoom = f"scale=w='trunc({W}*({expr_zoom(fases, z)})/2)*2':h='trunc({H}*({expr_zoom(fases, z)})/2)*2':eval=frame,crop={W}:{H}" if z != 1 else 'null'

    saida = tmp / f'b{i}.mp4'
    entradas = ['-i', str(src)]
    fc = (f"[0:v]select='{sel}',setpts=N/FRAME_RATE/TB,fps={FPS},{filtro_enq},{zoom},setsar=1[v0];"
          f"[0:a]{FILTRO_VOZ},aselect='{sel}',asetpts=N/SR/TB,aresample=48000[a0]")
    ultimo = 'v0'
    for k, ap in enumerate(bloco.get('apoio', []) or []):
        arq = (pasta_proj / ap['arquivo']).resolve()
        if not arq.exists():
            log(f'  aviso: cena de apoio nao encontrada: {arq.name}')
            continue
        ia = probe(arq)
        di = float(ap.get('duracao', min(4.0, ia['dur'])))
        t0 = float(ap.get('inicio', max(0.0, dur_corte * 0.35)))
        di = min(di, ia['dur'], max(0.5, dur_corte - t0))
        entradas += ['-i', str(arq)]
        n = len(entradas) // 2 - 1
        fe, _ = enquadrar(W, H, ia['w'], ia['h'], f'p{k}')
        fc += (f";[{n}:v]trim=0:{di:.3f},setpts=PTS-STARTPTS+{t0:.3f}/TB,fps={FPS},{fe},"
               f"scale='trunc({W}*(1+0.04*if(gte(t,{t0:.3f}),t-{t0:.3f},0)/{di:.3f})/2)*2':'trunc({H}*(1+0.04*if(gte(t,{t0:.3f}),t-{t0:.3f},0)/{di:.3f})/2)*2':eval=frame,crop={W}:{H},"
               f"format=yuva420p,fade=in:st={t0:.3f}:d=0.25:alpha=1,fade=out:st={t0 + di - 0.25:.3f}:d=0.25:alpha=1[ap{k}];"
               f"[{ultimo}][ap{k}]overlay=eof_action=pass:enable='between(t,{t0:.3f},{t0 + di:.3f})'[vv{k}]")
        ultimo = f'vv{k}'
    run(['ffmpeg', '-y', '-v', 'error', *entradas, '-filter_complex', fc, '-map', f'[{ultimo}]', '-map', '[a0]', *VENC, '-t', f'{dur_corte:.3f}', str(saida)])
    meio_fala = falas[len(falas) // 2] if falas else (0, info['dur'])
    return dict(arquivo=saida, dur=probe(saida)['dur'], eventos=eventos, metodo=metodo, original=info['dur'], cortes=len(seg) - 1,
                fonte=src, quadro_t=(meio_fala[0] + meio_fala[1]) / 2)


def cartela_video(png, segundos, saida, W, H, zoom=True):
    n = int(segundos * FPS)
    vf = (f"scale={W * 2}:{H * 2},zoompan=z='min(zoom+0.0006,1.05)':d={n}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={W}x{H}:fps={FPS}" if zoom
          else f'scale={W}:{H}')
    vf += f',fade=in:st=0:d=0.35,fade=out:st={segundos - 0.35:.2f}:d=0.35,setsar=1'
    run(['ffmpeg', '-y', '-v', 'error', '-loop', '1', '-i', str(png), '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
         '-vf', vf, '-t', f'{segundos:.2f}', *VENC, '-shortest', str(saida)])


def montar(cfg, pasta_proj, formato, estilo, saida_dir, args):
    W, H = FORMATOS[formato]
    tmp = Path(tempfile.mkdtemp(prefix=f'editor_{formato}_'))
    log(f'formato {formato} ({W}x{H}), estilo {estilo}')
    blocos = []
    for i, b in enumerate(cfg['blocos']):
        log(f'  bloco {i + 1}/{len(cfg["blocos"])}: {b["arquivo"]}')
        blocos.append(processar_bloco(i, b, pasta_proj, W, H, estilo, cfg, tmp, args))
    # corpo: blocos em sequencia
    lista = tmp / 'lista.txt'
    lista.write_text(''.join(f"file '{b['arquivo']}'\n" for b in blocos))
    corpo = tmp / 'corpo.mp4'
    run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', str(lista), *VENC, str(corpo)])
    eventos, off = [], 0.0
    for b in blocos:
        eventos += [[a + off, c + off, t, f] for a, c, t, f in b['eventos']]
        off += b['dur']
    ap = cfg.get('apresentador') or {}
    lower = (0.6, min(5.5, off), ap.get('nome', ''), ap.get('cargo', '')) if ap.get('nome') else None
    ass = tmp / 'legendas.ass'
    escrever_ass(ass, W, H, eventos, estilo, cfg, lower)
    corpo_leg = tmp / 'corpo_leg.mp4'
    run(['ffmpeg', '-y', '-v', 'error', '-i', str(corpo), '-vf', f"subtitles='{ass}':fontsdir='{FONTES}'", *VENC, str(corpo_leg)])

    # abertura e encerramento
    pecas, deslocamento = [], 0.0
    if cfg.get('abertura', True):
        png = tmp / 'abertura.png'
        cartela_abertura(png, W, H, cfg)
        cartela_video(png, float(cfg.get('dur_abertura', 2.8)), tmp / 'abertura.mp4', W, H)
        pecas.append(tmp / 'abertura.mp4')
        deslocamento = float(cfg.get('dur_abertura', 2.8))
    pecas.append(corpo_leg)
    if cfg.get('encerramento', True):
        png = tmp / 'final.png'
        cartela_final(png, W, H, cfg)
        cartela_video(png, float(cfg.get('dur_final', 4.5)), tmp / 'final.mp4', W, H, zoom=False)
        pecas.append(tmp / 'final.mp4')
    # junta com transicoes suaves (crossfade curto)
    durs = [probe(p)['dur'] for p in pecas]
    inputs = sum([['-i', str(p)] for p in pecas], [])
    xf, fc, acc = 0.3, '', durs[0]
    vprev, aprev = '0:v', '0:a'
    for k in range(1, len(pecas)):
        fc += f'[{vprev}][{k}:v]xfade=transition=fade:duration={xf}:offset={acc - xf:.3f}[v{k}];[{aprev}][{k}:a]acrossfade=d={xf}[a{k}];'
        vprev, aprev, acc = f'v{k}', f'a{k}', acc + durs[k] - xf
    total = acc
    juntado = tmp / 'juntado.mp4'
    if len(pecas) > 1:
        run(['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex', fc.rstrip(';'), '-map', f'[{vprev}]', '-map', f'[{aprev}]', *VENC, str(juntado)])
    else:
        shutil.copy(pecas[0], juntado)

    # audio final: trilha com ducking + efeitos + volume padrao (-14 LUFS)
    import unicodedata
    nome = cfg.get('nome_saida') or re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFKD', cfg['titulo'].lower()).encode('ascii', 'ignore').decode()).strip('-')
    final = saida_dir / f'{nome}-{formato}.mp4'
    entradas = ['-i', str(juntado)]
    fa = '[0:a]aresample=48000[voz]'
    mix = ['[voz]']
    trilha = cfg.get('trilha')
    if trilha and (pasta_proj / trilha).exists():
        entradas += ['-stream_loop', '-1', '-i', str((pasta_proj / trilha).resolve())]
        vol = float(cfg.get('volume_trilha', 0.18))
        fa = (f'[0:a]aresample=48000,asplit=2[voz][sc];[1:a]aresample=48000,volume={vol},atrim=0:{total:.3f},'
              f'afade=in:d=1,afade=out:st={max(0, total - 2.5):.3f}:d=2.5[mus];[mus][sc]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=350[duck]')
        mix.append('[duck]')
    if ESTILOS[estilo]['sfx'] and not cfg.get('sem_efeitos'):
        cortes = [deslocamento - 0.3] if deslocamento else []
        t = deslocamento
        for b in blocos[:-1]:
            t += b['dur']
            cortes.append(t - 0.3)
        for j, tc in enumerate(cortes):
            fa += (f';anoisesrc=d=0.55:c=pink:a=0.5,highpass=f=600,lowpass=f=5000,afade=in:d=0.3,afade=out:st=0.3:d=0.25,'
                   f'volume=0.22,aresample=48000,aformat=channel_layouts=stereo,adelay=delays={int(max(0, tc) * 1000)}:all=1[s{j}]')
            mix.append(f'[s{j}]')
    if len(mix) > 1:
        fa += f";{''.join(mix)}amix=inputs={len(mix)}:duration=first:normalize=0[mx];[mx]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]"
    else:
        fa += ';[voz]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]'
    run(['ffmpeg', '-y', '-v', 'error', *entradas, '-filter_complex', fa, '-map', '0:v', '-map', '[aout]',
         '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-t', f'{total:.3f}', str(final)])
    # legenda .srt (no tempo do video final) e capa
    srt = saida_dir / f'{nome}-{formato}.srt'
    escrever_srt(srt, [[a + deslocamento, c + deslocamento, t, f] for a, c, t, f in eventos])
    rel = [f'{formato}: {total:.1f} s no total']
    for k, b in enumerate(blocos):
        rel.append(f'  bloco {k + 1}: {b["original"]:.1f} s gravados -> {b["dur"]:.1f} s ({b["cortes"]} pausas cortadas), legenda por {b["metodo"]}')
    if formato == 'horizontal' or 'horizontal' not in args.formatos:
        quadro = tmp / 'quadro.jpg'
        # quadro do apresentador falando (da gravacao original, sem legenda nem cena de apoio)
        run(['ffmpeg', '-y', '-v', 'error', '-ss', f'{blocos[0]["quadro_t"]:.2f}', '-i', str(blocos[0]['fonte']), '-frames:v', '1', str(quadro)])
        capa(saida_dir / f'{nome}-capa.jpg', quadro, cfg)
    if not args.manter_temp:
        shutil.rmtree(tmp, ignore_errors=True)
    log('  pronto:', final.name)
    return final, rel


def main():
    ap = argparse.ArgumentParser(description='Editor de video do NotificaAI')
    ap.add_argument('projeto', help='arquivo .json do projeto')
    ap.add_argument('--formatos', default=None, help='horizontal,vertical (padrao: os do projeto)')
    ap.add_argument('--estilo', default=None, choices=list(ESTILOS), help='institucional ou reels')
    ap.add_argument('--saida', default=None, help='pasta de saida (padrao: <projeto>/saida)')
    ap.add_argument('--modelo', default='small', help='modelo de transcricao (tiny, base, small, medium)')
    ap.add_argument('--sem-transcricao', action='store_true', help='usa so o texto do roteiro para a legenda')
    ap.add_argument('--manter-temp', action='store_true')
    args = ap.parse_args()
    proj = Path(args.projeto).resolve()
    cfg = json.loads(proj.read_text(encoding='utf-8'))
    pasta = proj.parent
    formatos = (args.formatos or ','.join(cfg.get('formatos', ['horizontal', 'vertical']))).split(',')
    args.formatos = formatos
    saida = Path(args.saida or (pasta / 'saida')).resolve()
    saida.mkdir(parents=True, exist_ok=True)
    relatorio = []
    for f in formatos:
        estilo = args.estilo or cfg.get('estilo_' + f) or cfg.get('estilo') or ('reels' if f == 'vertical' else 'institucional')
        _, rel = montar(cfg, pasta, f.strip(), estilo, saida, args)
        relatorio += rel
    (saida / 'relatorio.txt').write_text('\n'.join(relatorio) + '\n', encoding='utf-8')
    print('\n'.join(relatorio))
    log('arquivos em', saida)


if __name__ == '__main__':
    main()
