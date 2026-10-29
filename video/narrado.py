#!/usr/bin/env python3
"""
Video narrado (sem apresentador): narracao gravada + fotos do hospital + graficos.

Cada "cena" do projeto corresponde a um trecho do roteiro. O programa:
  1. limpa a narracao e encurta as pausas longas;
  2. descobre onde cada cena comeca na fala (pelas pausas, proporcional ao texto);
  3. monta cada cena: foto com movimento lento (com areas borradas, se pedido),
     cartao com texto, pulseira ilustrada ou mensagem de destaque;
  4. legenda a narracao, junta com transicoes, fecha com QR code e gera capa e .srt.

Uso: python3 video/narrado.py video/projetos/<tema>/narrado.json [--formatos vertical]
"""
import argparse, json, re, shutil, subprocess, sys, tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).parent))
from editor import (FILTRO_VOZ, FORMATOS, FPS, VENC, ESTILOS, cartela_final, detectar_silencios, escrever_ass, escrever_srt,
                    fonte, gradiente, hex_rgb, intervalos_fala, log, nivel_medio, pedacos_texto, probe, run, texto_quebrado)


# ── transcricao (Whisper via sherpa-onnx, modelo baixado do GitHub) ───────────
WHISPER_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2'


def modelo_whisper():
    import os
    d = Path(os.environ.get('NOTIFICAAI_WHISPER_DIR', Path.home() / '.cache' / 'notificaai' / 'sherpa-onnx-whisper-small'))
    if (d / 'small-encoder.int8.onnx').exists():
        return d
    import tarfile, urllib.request
    d.parent.mkdir(parents=True, exist_ok=True)
    arq = d.parent / 'whisper-small.tar.bz2'
    log('baixando o modelo de transcricao (640 MB, so na primeira vez)')
    urllib.request.urlretrieve(WHISPER_URL, arq)
    with tarfile.open(arq) as t:
        membros = [m for m in t.getmembers() if m.name.endswith(('small-encoder.int8.onnx', 'small-decoder.int8.onnx', 'small-tokens.txt'))]
        t.extractall(d.parent, members=membros)
    arq.unlink()
    return d


def transcrever_trechos(audio, trechos):
    """Texto falado em cada trecho de fala (tempo original). None se a transcricao nao estiver disponivel."""
    try:
        import numpy as np
        import sherpa_onnx
        d = modelo_whisper()
        rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=str(d / 'small-encoder.int8.onnx'), decoder=str(d / 'small-decoder.int8.onnx'),
                                                         tokens=str(d / 'small-tokens.txt'), language='pt', task='transcribe', num_threads=4)
    except Exception as e:
        log('transcricao indisponivel (' + str(e)[:90] + '): legenda pelo roteiro, sincronia aproximada')
        return None
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(audio), '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], capture_output=True).stdout
    x = np.frombuffer(pcm, np.float32)
    textos = []
    for a, b in trechos:
        st = rec.create_stream()
        st.accept_waveform(16000, x[max(0, int((a - 0.1) * 16000)):int((b + 0.1) * 16000)])
        rec.decode_stream(st)
        textos.append(st.result.text.strip())
    return textos


def _norm(w):
    import unicodedata
    return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFKD', w.lower()).encode('ascii', 'ignore').decode())


def alinhar_palavras(texto, trechos, textos):
    """Tempo (original) de cada palavra do roteiro, alinhando-o com o que foi transcrito em cada trecho."""
    import difflib
    rot = texto.split()
    tr = []  # (palavra_norm, inicio, fim)
    for (a, b), t in zip(trechos, textos):
        ws = [w for w in t.split() if _norm(w)]
        if not ws:
            continue
        tot = sum(len(w) + 1 for w in ws)
        acc = 0
        for w in ws:
            ini = a + (b - a) * acc / tot
            acc += len(w) + 1
            tr.append((_norm(w), ini, a + (b - a) * acc / tot))
    if not tr:
        return None
    rn = [_norm(w) for w in rot]
    sm = difflib.SequenceMatcher(None, rn, [w[0] for w in tr], autojunk=False)
    tempos = [None] * len(rot)
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            tempos[blk.a + k] = (tr[blk.b + k][1], tr[blk.b + k][2])
    # palavras sem par: interpola entre as vizinhas
    conhecidos = [i for i, t in enumerate(tempos) if t]
    if not conhecidos:
        return None
    for i in range(len(rot)):
        if tempos[i]:
            continue
        ant = max([k for k in conhecidos if k < i], default=None)
        pro = min([k for k in conhecidos if k > i], default=None)
        if ant is None:
            tempos[i] = (tempos[pro][0], tempos[pro][0])
        elif pro is None:
            tempos[i] = (tempos[ant][1], tempos[ant][1])
        else:
            f = (i - ant) / (pro - ant)
            t = tempos[ant][1] + (tempos[pro][0] - tempos[ant][1]) * f
            tempos[i] = (t, t)
    return list(zip(rot, tempos))


def legendas_alinhadas(texto, legenda, palavras_t, max_palavras):
    """Eventos de legenda (tempo original): frases do roteiro no tempo real da fala; texto exibido vem da 'legenda'."""
    fr_fala = [f for f in re.split(r'(?<=[.!?…])\s+', texto.strip()) if f]
    fr_leg = [f for f in re.split(r'(?<=[.!?…])\s+', (legenda or texto).strip()) if f]
    if len(fr_leg) != len(fr_fala):
        fr_leg = fr_fala
    eventos, i = [], 0
    for ff, fl in zip(fr_fala, fr_leg):
        n = len(ff.split())
        bloco = palavras_t[i:i + n]
        i += n
        if not bloco:
            continue
        a, b = bloco[0][1][0], bloco[-1][1][1]
        peds = pedacos_texto(fl, max_palavras)
        tot = sum(len(p) + 1 for p, _ in peds)
        acc = 0
        for p, fim in peds:
            ini = a + (b - a) * acc / tot
            acc += len(p) + 1
            eventos.append([ini, a + (b - a) * acc / tot, p, fim])
    for k in range(len(eventos) - 1):  # sem piscar entre legendas proximas
        if eventos[k + 1][0] - eventos[k][1] < 0.6:
            eventos[k][1] = eventos[k + 1][0]
    return eventos


# ── tempo: blocos da narracao ─────────────────────────────────────────────────
def dividir_cenas(falas, cenas):
    """Escolhe, entre as pausas da fala, onde cada cena comeca: perto da posicao proporcional ao texto,
    preferindo pausas mais longas. Cena com 'inicio_fala' (indice do trecho de fala) fixa o inicio."""
    if len(cenas) == 1:
        return [0]
    chars = [max(1, len(c.get('texto', ''))) for c in cenas]
    total_c = sum(chars)
    t0, t1 = falas[0][0], falas[-1][1]
    inicios, usado = [0], 0
    for j in range(1, len(cenas)):
        if cenas[j].get('inicio_fala') is not None:
            k = int(cenas[j]['inicio_fala'])
        else:
            alvo = t0 + (t1 - t0) * sum(chars[:j]) / total_c
            melhor, k = 1e9, usado + 1
            for i in range(usado + 1, len(falas) - (len(cenas) - j - 1)):
                pausa = falas[i][0] - falas[i - 1][1]
                nota = abs(falas[i][0] - alvo) - 1.5 * min(pausa, 3.0)
                if nota < melhor:
                    melhor, k = nota, i
        k = max(usado + 1, min(k, len(falas) - (len(cenas) - j)))
        inicios.append(k)
        usado = k
    return inicios


# ── imagens ──────────────────────────────────────────────────────────────────
def foto_preparada(caminho, W, H, foco, borrar, margem=1.12):
    img = Image.open(caminho).convert('RGB')
    try:
        from PIL import ImageOps
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass
    for (x0, y0, x1, y1) in borrar or []:  # areas com papeis, telas ou pessoas
        box = (int(x0 * img.width), int(y0 * img.height), int(x1 * img.width), int(y1 * img.height))
        img.paste(img.crop(box).filter(ImageFilter.GaussianBlur(max(12, img.width // 120))), box)
    fx, fy = foco or (0.5, 0.5)
    alvo = W / H
    if img.width / img.height > alvo:
        nw = int(img.height * alvo)
        x = int(min(max(0, fx * img.width - nw / 2), img.width - nw))
        img = img.crop((x, 0, x + nw, img.height))
    else:
        nh = int(img.width / alvo)
        y = int(min(max(0, fy * img.height - nh / 2), img.height - nh))
        img = img.crop((0, y, img.width, y + nh))
    return img.resize((int(W * margem), int(H * margem)), Image.LANCZOS)


def painel_texto(W, H, cena, cfg):
    """Sobreposicao transparente com titulo e linhas de texto (lado esquerdo no horizontal, faixa superior no vertical)."""
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    if not (cena.get('titulo') or cena.get('linhas') or cena.get('selo')):
        return img
    d = ImageDraw.Draw(img)
    vert = H > W
    s = W / (1080 if vert else 1920)
    destaque, cor = hex_rgb(cfg.get('cor_destaque', '#FFD400')), hex_rgb(cfg.get('cor', '#0D9488'))
    if vert:
        x, larg, y = int(70 * s), W - int(140 * s), int(H * 0.11)
    else:
        sombra = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        ds = ImageDraw.Draw(sombra)
        for xx in range(int(W * 0.62)):
            ds.line([(xx, 0), (xx, H)], fill=(6, 16, 31, int(215 * (1 - xx / (W * 0.62)) ** 1.3)))
        img = Image.alpha_composite(img, sombra)
        d = ImageDraw.Draw(img)
        x, larg, y = int(110 * s), int(W * 0.44), int(H * 0.16)
    blocos = []
    if cena.get('selo'):
        blocos.append(('selo', cena['selo'], fonte('bold', int(32 * s))))
    if cena.get('titulo'):
        blocos.append(('titulo', cena['titulo'], fonte('black', int((84 if vert else 78) * s))))
    for ln in cena.get('linhas', []):
        blocos.append(('linha', ln, fonte('semibold', int((48 if vert else 44) * s))))
    # medir e desenhar (no vertical, uma caixa escura atras de tudo)
    medidas, alt = [], 0
    for tipo, txt, f in blocos:
        ls = texto_quebrado(d, txt, f, larg - (int(60 * s) if vert else 0) - (int(f.size * 0.6) if tipo == 'linha' else 0))
        if tipo == 'linha' and txt.startswith('!') and ls and not ls[0].startswith('!'):
            ls[0] = '!' + ls[0]
        h = int(f.size * (1.12 if tipo == 'titulo' else 1.35)) * len(ls) + int((18 if tipo != 'selo' else 26) * s)
        medidas.append((tipo, ls, f, h))
        alt += h
    if vert:
        pad = int(40 * s)
        d.rounded_rectangle([x - pad // 2, y - pad, x + larg + pad // 2, y + alt + pad // 2], radius=int(36 * s), fill=(6, 16, 31, 205))
        x += int(30 * s)
    for tipo, ls, f, h in medidas:
        neg_item = bool(ls) and ls[0].startswith('!')
        for nl, ln in enumerate(ls):
            if tipo == 'selo':
                w = d.textlength(ln, font=f)
                d.rounded_rectangle([x, y, x + w + int(36 * s), y + f.size + int(22 * s)], radius=int(10 * s), fill=cor)
                d.text((x + int(18 * s), y + int(9 * s)), ln, font=f, fill=(255, 255, 255))
                y += f.size + int(48 * s)
                continue
            ln = ln.lstrip('!')
            if tipo == 'linha':
                if nl == 0:
                    d.ellipse([x, y + f.size * 0.38, x + f.size * 0.36, y + f.size * 0.74], fill=(239, 68, 68) if neg_item else destaque)
                d.text((x + int(f.size * 0.6), y), ln, font=f, fill=(255, 255, 255))
                y += int(f.size * 1.35)
            else:
                d.text((x, y), ln, font=f, fill=(255, 255, 255))
                y += int(f.size * 1.12)
        y += int(18 * s)
    return img


def cartao_pulseira(W, H, cfg, cena):
    """Ilustracao de pulseira de identificacao com os dois identificadores em destaque."""
    img = gradiente(W, H, cfg.get('cor_fundo', '#06101F'), cfg.get('cor_fundo2', '#0D3B66')).convert('RGBA')
    d = ImageDraw.Draw(img)
    vert = H > W
    s = W / (1080 if vert else 1920)
    destaque, cor = hex_rgb(cfg.get('cor_destaque', '#FFD400')), hex_rgb(cfg.get('cor', '#0D9488'))
    bw, bh = int((940 if vert else 1240) * s), int((300 if vert else 300) * s)
    bx, by = (W - bw) // 2, int(H * (0.36 if vert else 0.30))
    # pulso (silhueta) e pulseira
    d.rounded_rectangle([bx - int(140 * s), by + int(40 * s), bx + bw + int(140 * s), by + bh - int(40 * s)], radius=int(110 * s), fill=(214, 170, 140))
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=int(46 * s), fill=(250, 250, 248), outline=(200, 205, 210), width=int(4 * s))
    d.rounded_rectangle([bx + int(24 * s), by + int(24 * s), bx + int(150 * s), by + bh - int(24 * s)], radius=int(20 * s), fill=cor)
    for i in range(14):  # codigo de barras
        xx = bx + bw - int(200 * s) + i * int(12 * s)
        d.rectangle([xx, by + int(70 * s), xx + int((4 if i % 3 else 8) * s), by + bh - int(70 * s)], fill=(40, 40, 40))
    fl, fv = fonte('semibold', int(30 * s)), fonte('extrabold', int(46 * s))
    tx = bx + int(185 * s)
    nome, nasc = cena.get('exemplo_nome', 'MARIA DA SILVA SOUZA'), cena.get('exemplo_nascimento', '12/03/1958')
    d.text((tx, by + int(48 * s)), 'NOME COMPLETO', font=fl, fill=(110, 120, 130))
    d.text((tx, by + int(84 * s)), nome, font=fv, fill=(20, 30, 40))
    d.text((tx, by + int(160 * s)), 'DATA DE NASCIMENTO', font=fl, fill=(110, 120, 130))
    d.text((tx, by + int(196 * s)), nasc, font=fv, fill=(20, 30, 40))
    # legenda dos dois identificadores
    fc = fonte('black', int((70 if vert else 64) * s))
    titulo = cena.get('titulo', '2 identificadores')
    for i, ln in enumerate(texto_quebrado(d, titulo, fc, W - int(160 * s))):
        d.text(((W - d.textlength(ln, font=fc)) / 2, int(H * (0.16 if vert else 0.10)) + i * int(fc.size * 1.1)), ln, font=fc, fill=(255, 255, 255))
    fr = fonte('bold', int((44 if vert else 40) * s))
    y = by + bh + int(80 * s)
    for ln in cena.get('linhas', []):
        neg = ln.startswith('!')
        ln = ln.lstrip('!')
        w = d.textlength(ln, font=fr)
        d.rounded_rectangle([(W - w) / 2 - int(30 * s), y, (W + w) / 2 + int(30 * s), y + fr.size + int(30 * s)], radius=int(16 * s), fill=(239, 68, 68) if neg else destaque)
        d.text(((W - w) / 2, y + int(12 * s)), ln, font=fr, fill=(255, 255, 255) if neg else (6, 16, 31))
        y += fr.size + int(60 * s)
    return img


def cartao_mensagem(W, H, cfg, cena):
    img = gradiente(W, H, cfg.get('cor_fundo', '#06101F'), cfg.get('cor_fundo2', '#0D3B66')).convert('RGBA')
    d = ImageDraw.Draw(img)
    vert = H > W
    s = W / (1080 if vert else 1920)
    destaque = hex_rgb(cfg.get('cor_destaque', '#FFD400'))
    f1, f2 = fonte('black', int((88 if vert else 92) * s)), fonte('black', int((104 if vert else 112) * s))
    marg = int(110 * s)
    l1 = texto_quebrado(d, cena.get('titulo', ''), f1, W - 2 * marg)
    l2 = texto_quebrado(d, cena.get('destaque', ''), f2, W - 2 * marg)
    alt = len(l1) * f1.size * 1.12 + int(50 * s) + len(l2) * f2.size * 1.1
    y = (H - alt) / 2
    for ln in l1:
        d.text(((W - d.textlength(ln, font=f1)) / 2, y), ln, font=f1, fill=(255, 255, 255))
        y += f1.size * 1.12
    y += int(20 * s)
    d.rectangle([(W - int(160 * s)) / 2, y, (W + int(160 * s)) / 2, y + int(14 * s)], fill=destaque)
    y += int(46 * s)
    for ln in l2:
        d.text(((W - d.textlength(ln, font=f2)) / 2, y), ln, font=f2, fill=destaque)
        y += f2.size * 1.1
    return img


def clipe_cena(cena, i, W, H, dur, pasta, cfg, tmp):
    tipo = cena.get('tipo', 'foto')
    n = max(2, int(round(dur * FPS)))
    saida = tmp / f'c{i}.mp4'
    if tipo == 'final':
        png = tmp / f'c{i}.png'
        cartela_final(png, W, H, cfg)
        run(['ffmpeg', '-y', '-v', 'error', '-loop', '1', '-i', str(png), '-vf', f'scale={W}:{H},fps={FPS},fade=in:st=0:d=0.3,setsar=1',
             '-t', f'{dur:.3f}', '-an', *VENC[:10], str(saida)])
        return saida
    if tipo == 'foto':
        foco = cena.get('foco_h' if W > H else 'foco_v') or cena.get('foco')
        base = foto_preparada(pasta / cena['foto'], W, H, foco, cena.get('borrar'))
    elif tipo == 'pulseira':
        base = cartao_pulseira(W, H, cfg, cena).convert('RGB').resize((int(W * 1.06), int(H * 1.06)), Image.LANCZOS)
    else:
        base = cartao_mensagem(W, H, cfg, cena).convert('RGB').resize((int(W * 1.06), int(H * 1.06)), Image.LANCZOS)
    bpng = tmp / f'c{i}_base.png'
    base.save(bpng)
    # movimento lento: zoom de 1.00 a ~1.07 em direcao ao foco (ou inverso, alternando entre cenas)
    zf = float(cena.get('zoom', 0.07 if tipo == 'foto' else 0.04))
    ent = (i % 2 == 0)
    z = f"if(eq(on,0),1,min(1+{zf}*on/{n},1+{zf}))" if ent else f"max(1+{zf}-{zf}*on/{n},1)"
    vf = (f"scale={base.width * 2}:{base.height * 2},zoompan=z='{z}':d={n}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={W}x{H}:fps={FPS},setsar=1")
    entradas, fc = ['-loop', '1', '-i', str(bpng)], f'[0:v]{vf}[v0]'
    if tipo == 'foto':
        ov = tmp / f'c{i}_txt.png'
        painel_texto(W, H, cena, cfg).save(ov)
        entradas += ['-loop', '1', '-i', str(ov)]
        fc += f";[1:v]format=rgba,fade=in:st=0.35:d=0.45:alpha=1[t];[v0][t]overlay=0:0:shortest=1[v1]"
        mapa = '[v1]'
    else:
        mapa = '[v0]'
    run(['ffmpeg', '-y', '-v', 'error', *entradas, '-filter_complex', fc, '-map', mapa, '-t', f'{dur:.3f}', '-an', *VENC[:10], str(saida)])
    return saida


# ── montagem ─────────────────────────────────────────────────────────────────
def montar(cfg, pasta, formato, estilo, saida_dir):
    W, H = FORMATOS[formato]
    tmp = Path(tempfile.mkdtemp(prefix=f'narrado_{formato}_'))
    narr = (pasta / cfg['narracao']).resolve()
    info = probe(narr)
    nivel = nivel_medio(narr)
    if nivel < -70:
        raise RuntimeError(f'a narracao esta muda ({nivel:.0f} dB)')
    sil = detectar_silencios(narr, cfg.get('ruido_db') or max(-50, min(-30, round(nivel - 16))), cfg.get('silencio_min', 0.35))
    falas = intervalos_fala(info['dur'], sil)
    cenas = cfg['cenas']
    falando = [c for c in cenas if c.get('texto')]
    ini_idx = dividir_cenas(falas, falando)
    # trechos de fala de cada cena falada
    grupos = []
    for j, k in enumerate(ini_idx):
        fim = ini_idx[j + 1] if j + 1 < len(ini_idx) else len(falas)
        grupos.append(falas[k:fim])
    # nova linha do tempo: pausas dentro da cena ate 'pausa_max', entre cenas 'pausa_cena'
    pad, pmax, pcena = cfg.get('folga', 0.15), cfg.get('pausa_max', 0.45), cfg.get('pausa_cena', 0.7)
    seg, mapa_cenas, t = [], [], 0.0
    for j, g in enumerate(grupos):
        c_ini = t
        partes = []
        for a, b in g:
            a2, b2 = max(0, a - pad), min(info['dur'], b + pad)
            if partes and a2 - partes[-1][1] < pmax:
                partes[-1] = (partes[-1][0], b2)
            else:
                partes.append((a2, b2))
        if j < len(grupos) - 1 and partes:
            prox = grupos[j + 1][0][0] - pad
            a_, b_ = partes[-1]
            partes[-1] = (a_, min(prox, b_ + max(0, pcena - 2 * pad)))
        falas_c = []
        for a, b in partes:
            falas_c.append((t, t + (b - a)))
            seg.append((a, b))
            t += (b - a)
        mapa_cenas.append((c_ini, t, falas_c))
    sel = '+'.join(f'between(t,{a:.3f},{b:.3f})' for a, b in seg)
    # pausas: o select junta os trechos colados; pausas curtas entre trechos e cenas vem do proprio 'pad'
    voz = tmp / 'voz.wav'
    run(['ffmpeg', '-y', '-v', 'error', '-i', str(narr), '-af', f"{FILTRO_VOZ},aselect='{sel}',asetpts=N/SR/TB,aresample=48000", '-ac', '2', str(voz)])
    dur_voz = probe(voz)['dur']
    # distribui as cenas no tempo final (cenas sem texto, como o 'final', herdam o fim)
    tempos, j = [], 0
    for c in cenas:
        if c.get('texto'):
            a, b, fc_ = mapa_cenas[j]
            tempos.append([a, b, fc_])
            j += 1
        else:
            tempos.append(None)
    sobra = float(cfg.get('dur_final_extra', 2.5))
    total = dur_voz + sobra
    marcos = []
    for i, c in enumerate(cenas):
        if tempos[i]:
            marcos.append(tempos[i][0])
        else:  # cena sem fala: comeca no 'inicio_em' (s) ou no fim da fala anterior
            marcos.append(float(c['inicio_em']) if c.get('inicio_em') is not None else (tempos[i - 1][1] if i and tempos[i - 1] else dur_voz))
    # legendas: com transcricao, cada frase no tempo real em que foi dita; sem, distribuidas pelo roteiro
    from editor import legendas_por_roteiro, mapear
    e = ESTILOS[estilo]
    ev_cena = {}
    textos = transcrever_trechos(narr, falas) if not cfg.get('sem_transcricao') else None
    jj = 0
    for i, c in enumerate(cenas):
        if not tempos[i]:
            continue
        g = grupos[jj]
        k0 = ini_idx[jj]
        jj += 1
        if c.get('sem_legenda'):
            continue
        pal = alinhar_palavras(c['texto'], g, textos[k0:k0 + len(g)]) if textos else None
        if pal:
            ev = legendas_alinhadas(c['texto'], c.get('legenda'), pal, e['palavras'])
            ev_cena[i] = [[mapear(a, seg), mapear(b, seg), t, f] for a, b, t, f in ev]
        else:
            ev_cena[i] = legendas_por_roteiro(c.get('legenda', c['texto']), tempos[i][2], e['palavras'])
    # cena 'final' pode comecar dentro da fala anterior (ex.: em "Viu algo errado?")
    for i, c in enumerate(cenas):
        if c.get('tipo') == 'final' and c.get('no_texto') and i and (i - 1) in ev_cena:
            alvo = c['no_texto'].lower().split()[0]
            for ev in ev_cena[i - 1]:
                if ev[2].lower().startswith(alvo):
                    marcos[i] = ev[0] - 0.15
                    break
    marcos.append(total)
    xf = 0.35
    clipes = []
    for i, c in enumerate(cenas):
        dur = marcos[i + 1] - marcos[i] + (xf if i < len(cenas) - 1 else 0)
        log(f'  cena {i + 1}: {c.get("tipo", "foto")} {marcos[i]:.1f}s -> {marcos[i + 1]:.1f}s')
        clipes.append(clipe_cena(c, i, W, H, max(0.6, dur), pasta, cfg, tmp))
    inputs = sum([['-i', str(p)] for p in clipes], [])
    fc, prev = '', '0:v'
    for k in range(1, len(clipes)):
        fc += f'[{prev}][{k}:v]xfade=transition=fade:duration={xf}:offset={marcos[k]:.3f}[x{k}];'
        prev = f'x{k}'
    video = tmp / 'video.mp4'
    if len(clipes) > 1:
        run(['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex', fc.rstrip(';'), '-map', f'[{prev}]', '-t', f'{total:.3f}', *VENC[:10], str(video)])
    else:
        shutil.copy(clipes[0], video)
    # sem legenda por cima do cartao final (o texto ja esta nele)
    ini_final = next((marcos[i] for i, c in enumerate(cenas) if c.get('tipo') == 'final'), total)
    eventos = [ev for i in sorted(ev_cena) if cenas[i].get('tipo') != 'mensagem' for ev in ev_cena[i] if ev[0] < ini_final - 0.05]
    for ev in eventos:
        ev[1] = min(ev[1], ini_final)
    ass = tmp / 'leg.ass'
    escrever_ass(ass, W, H, eventos, estilo, cfg, None)
    import unicodedata
    nome = cfg.get('nome_saida') or re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFKD', cfg['titulo'].lower()).encode('ascii', 'ignore').decode()).strip('-')
    final = saida_dir / f'{nome}-{formato}.mp4'
    entradas = ['-i', str(video), '-i', str(voz)]
    fa = f'[1:a]apad=whole_dur={total:.3f}[voz]'
    mix = '[voz]'
    trilha = cfg.get('trilha')
    if trilha and (pasta / trilha).exists():
        entradas += ['-stream_loop', '-1', '-i', str((pasta / trilha).resolve())]
        vol = float(cfg.get('volume_trilha', 0.15))
        fa = (f'[1:a]apad=whole_dur={total:.3f},asplit=2[voz][sc];[2:a]aresample=48000,volume={vol},atrim=0:{total:.3f},afade=in:d=1,'
              f'afade=out:st={max(0, total - 2.5):.3f}:d=2.5[mus];[mus][sc]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=350[duck];'
              f'[voz][duck]amix=inputs=2:duration=first:normalize=0[mx]')
        mix = '[mx]'
    fa += f';{mix}loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]'
    from editor import FONTES
    run(['ffmpeg', '-y', '-v', 'error', *entradas, '-filter_complex', f"[0:v]subtitles='{ass}':fontsdir='{FONTES}'[v];{fa}",
         '-map', '[v]', '-map', '[aout]', *VENC, '-movflags', '+faststart', '-t', f'{total:.3f}', str(final)])
    escrever_srt(saida_dir / f'{nome}-{formato}.srt', eventos)
    shutil.rmtree(tmp, ignore_errors=True)
    log('  pronto:', final.name)
    return final, [f'{formato}: {total:.1f} s (narração de {info["dur"]:.1f} s, pausas encurtadas para {dur_voz:.1f} s)'] + \
        [f'  cena {i + 1} ({c.get("tipo", "foto")}): {marcos[i]:.1f}–{marcos[i + 1]:.1f} s' for i, c in enumerate(cenas)]


def main():
    ap = argparse.ArgumentParser(description='Video narrado do NotificaAI (narracao + fotos + graficos)')
    ap.add_argument('projeto')
    ap.add_argument('--formatos', default=None)
    ap.add_argument('--estilo', default=None, choices=list(ESTILOS))
    ap.add_argument('--saida', default=None)
    args = ap.parse_args()
    proj = Path(args.projeto).resolve()
    cfg = json.loads(proj.read_text(encoding='utf-8'))
    pasta = proj.parent
    saida = Path(args.saida or (pasta / 'saida')).resolve()
    saida.mkdir(parents=True, exist_ok=True)
    rel = []
    for f in (args.formatos or ','.join(cfg.get('formatos', ['horizontal', 'vertical']))).split(','):
        f = f.strip()
        estilo = args.estilo or cfg.get('estilo_' + f) or cfg.get('estilo') or ('reels' if f == 'vertical' else 'institucional')
        log(f'formato {f}, estilo {estilo}')
        _, r = montar(cfg, pasta, f, estilo, saida)
        rel += r
    (saida / 'relatorio.txt').write_text('\n'.join(rel) + '\n', encoding='utf-8')
    print('\n'.join(rel))


if __name__ == '__main__':
    main()
