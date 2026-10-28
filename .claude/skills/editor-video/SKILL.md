---
name: editor-video
description: Edita vídeos de educação em saúde do NotificaAI/HNSA a partir das gravações brutas (cortes de pausas, limpeza de áudio, legenda, zoom, cenas de apoio, abertura, nome e cargo, encerramento com QR, trilha com ducking, capa, versões horizontal e vertical). Use quando o usuário mandar vídeos para editar ou pedir um vídeo pronto para YouTube/Reels.
---

# Editor de vídeo

Ferramenta: `video/editor.py` (documentação completa em `video/README.md`).

## Passo a passo

1. **Receber os arquivos** (anexo do chat em `/root/.claude/uploads/...` ou Google Drive). Copie cada um para uma pasta nova de trabalho, ex.: `video/projetos/<tema>/` (vídeos não vão para o Git).
2. **Conferir antes de editar**:
   - `ffprobe` (duração, resolução, se há áudio);
   - nível de áudio: `ffmpeg -i X -af volumedetect -f null -` (média abaixo de −70 dB = vídeo mudo: avise o usuário, não edite);
   - folha de contato para ver enquadramento e se é o apresentador mesmo: `ffmpeg -i X -vf "fps=1/3,scale=320:-1,tile=6x2" -frames:v 1 contato.jpg` e abra a imagem.
3. **Montar o `projeto.json`** a partir de `video/projetos/quedas/projeto.json`, usando o texto do roteiro de cada bloco (documento "Roteiros · Vídeos de Educação em Saúde HNSA").
4. **Rodar** `python3 video/editor.py video/projetos/<tema>/projeto.json`. Sem acesso a huggingface.co a legenda vem do roteiro; com acesso, de transcrição palavra a palavra.
5. **Revisar o resultado antes de entregar**: folha de contato dos dois formatos, `ebur128` (deve dar ≈ −14 LUFS), primeiras linhas do `.srt`. Corrija enquadramento, sobreposição de textos ou cortes errados.
6. **Entregar** com `SendUserFile` (vídeos, capa, srt) e o `relatorio.txt` resumido. Lembre: autorização para uso de farda e imagens do hospital; sem pacientes identificáveis; no YouTube, marcar "conteúdo alterado ou sintético" se houver cenas geradas por IA.

## Limites a dizer ao usuário

- Sem transcrição, o editor não percebe uma frase errada e repetida: peça um arquivo por bloco, sem erros.
- A sincronia da legenda pelo roteiro é aproximada; peça para ele assistir e apontar ajustes.
