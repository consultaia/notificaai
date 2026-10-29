# Editor de vídeo do NotificaAI

Transforma as gravações brutas (um arquivo por bloco do roteiro) em vídeo pronto:

| Saída | Para quê |
|---|---|
| `<titulo>-horizontal.mp4` (1920×1080, estilo institucional) | YouTube, plataforma, TV do hospital |
| `<titulo>-vertical.mp4` (1080×1920, estilo reels) | Reels, status do WhatsApp, Shorts |
| `<titulo>-*.srt` | Legenda para enviar ao YouTube |
| `<titulo>-capa.jpg` (1280×720) | Capa do YouTube |
| `relatorio.txt` | Quanto foi cortado em cada bloco e como a legenda foi feita |

## O que ele faz

1. **Áudio**: filtros de voz, redução de ruído, compressão e volume padrão de streaming (−14 LUFS).
2. **Cortes**: tira o início e o fim mortos, respiros e pausas longas (detecção de silêncio adaptada ao nível de cada gravação).
3. **Enquadramento**: corta o centro quando a proporção é parecida; senão, o vídeo inteiro sobre fundo desfocado.
4. **Zoom**: troca a cada frase (punch-in): leve no institucional, marcado no reels.
5. **Cenas de apoio** (b-roll) por cima da fala, com leve movimento e transição suave.
6. **Legenda**: palavra a palavra com transcrição automática (se o `faster-whisper` e o acesso a `huggingface.co` estiverem disponíveis); senão, o texto do roteiro distribuído sobre a fala. Reels: legenda grande com a palavra-chave em amarelo e efeito de entrada. Institucional: faixa escura discreta.
7. **Nome e cargo** na tela no início, **abertura** animada com o tema e **encerramento** com QR code e link.
8. **Troca de fundo** (opcional): recorta o apresentador quadro a quadro com IA (Robust Video Matting, roda no computador, sem enviar nada para fora) e coloca sobre uma foto do hospital, com desfoque de profundidade e movimento lento. Não precisa de fundo verde.
9. **Trilha** com *ducking* (abaixa sozinha quando há fala) e efeitos sonoros discretos nas transições (estilo reels).

## Como usar

1. Crie uma pasta em `video/projetos/<tema>/` com as gravações (`01.mp4`, `02.mp4`…), cenas de apoio e trilha (opcional).
2. Copie `video/projetos/quedas/projeto.json` e ajuste título, apresentador e o texto de cada bloco (o mesmo do roteiro).
3. Rode:

```bash
python3 video/editor.py video/projetos/<tema>/projeto.json
# opções: --formatos vertical   --estilo reels|institucional   --sem-transcricao   --modelo small
```

Os arquivos ficam em `video/projetos/<tema>/saida/`. Vídeos e áudios não vão para o Git (ver `.gitignore`).

## Campos do projeto.json

| Campo | Uso |
|---|---|
| `titulo`, `subtitulo`, `rotulo` | Abertura |
| `titulo_capa` | Texto da capa (padrão: `titulo`) |
| `instituicao` | Rodapé da abertura e do encerramento |
| `apresentador.nome`, `apresentador.cargo` | Nome e cargo na tela nos primeiros segundos |
| `link`, `qr`, `chamada_final` | Encerramento |
| `cor`, `cor_destaque`, `cor_fundo`, `cor_fundo2` | Identidade visual |
| `logo` | PNG transparente opcional na abertura (ex.: brasão, com autorização) |
| `fundo` (projeto ou bloco) | Foto do hospital para trocar o fundo atrás do apresentador |
| `posicao` | `direita`, `esquerda` ou `centro` (padrão: direita no horizontal, centro no vertical) |
| `fundo_desfoque`, `fundo_escurecer` | Intensidade do desfoque (padrão 8) e do escurecimento (0,12) da foto |
| `trilha`, `volume_trilha` | Música de fundo (use faixas sem direitos autorais, ex.: Biblioteca de Áudio do YouTube) |
| `estilo`, `estilo_horizontal`, `estilo_vertical` | `institucional` ou `reels` |
| `abertura`, `encerramento` | `false` para não usar |
| `blocos[].arquivo`, `blocos[].texto` | Gravação e fala do bloco |
| `blocos[].apoio[]` | Cenas de apoio: `arquivo`, `inicio` (s, no bloco já cortado), `duracao` |
| `blocos[].cortar`, `sem_zoom`, `sem_legenda` | Desligar etapas num bloco |
| `ruido_db`, `silencio_min`, `pausa_max`, `folga` | Ajuste fino dos cortes |

Troca de fundo precisa de `pip install onnxruntime numpy`; o modelo (15 MB) é baixado na primeira vez para `~/.cache/notificaai/`. Velocidade: cerca de 4 a 9 quadros por segundo na CPU (1 min de vídeo leva alguns minutos).

## Vídeo narrado (sem apresentador)

`video/narrado.py` monta o vídeo só com a narração gravada, fotos do hospital e gráficos:

```bash
python3 video/narrado.py video/projetos/identificacao/narrado.json
```

- **Cenas** (`cenas[]`): `foto` (foto com movimento lento e painel de texto: `selo`, `titulo`, `linhas`; linha que começa com `!` sai em vermelho), `pulseira` (ilustração com os dois identificadores), `mensagem` (frase de destaque) e `final` (QR code). Cada cena com fala tem o `texto` do roteiro (como foi falado) e, se quiser, a `legenda` (como deve aparecer, ex.: o endereço escrito).
- **Fotos**: `foco` (ponto de interesse, de 0 a 1), `foco_h`/`foco_v` por formato, `borrar` (retângulos em fração da foto para esconder papéis, telas ou pessoas), `zoom`.
- **Sincronia**: transcreve a narração com Whisper (modelo `sherpa-onnx-whisper-small`, 640 MB, baixado do GitHub na primeira vez para `~/.cache/notificaai/`; requer `pip install sherpa-onnx numpy`) e alinha o texto do roteiro com o que foi dito: cada frase da legenda e cada troca de cena caem na hora certa. A cena `final` pode começar numa frase (`"no_texto": "Viu algo errado"`). Sem a transcrição, a legenda é distribuída pelas pausas (aproximada).
- **Pausas**: as longas são encurtadas (`pausa_max` dentro da cena, `pausa_cena` entre cenas).

## Como gravar

- Celular na horizontal (ou vertical, se o foco for Reels), na altura dos olhos, 1080p/30 fps.
- Luz de frente, local silencioso; microfone de lapela melhora muito.
- Para trocar o fundo: parede lisa que contraste com a roupa (farda branca: parede de cor média, não branca), câmera parada (tripé), enquadramento da cintura para cima, sem objetos atrás da cabeça.
- Fotos de fundo: horizontais, nítidas, bem iluminadas, sem pacientes, rostos, prontuários ou telas com dados.
- Um arquivo por bloco; errou, recomece o bloco (sem transcrição o editor não percebe repetições).
- 2 segundos parado antes e depois de falar.
