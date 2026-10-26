// Áudio do cliente -> texto, com o Whisper do Groq (gratuito).
// Usa a chave do Groq do próprio corretor, se ele cadastrou; senão a da plataforma.
const URL_GROQ = "https://api.groq.com/openai/v1/audio/transcriptions";
const LIMITE_BYTES = 24 * 1024 * 1024; // o Groq aceita até 25 MB no plano gratuito

export async function transcrever(chaves, { dados, tipo }, env) {
  if (dados.byteLength > LIMITE_BYTES) throw new Error("áudio grande demais");
  const extensao = tipo.includes("mpeg") ? "mp3" : tipo.includes("mp4") || tipo.includes("aac") ? "m4a" : "ogg";
  let ultimoErro;
  for (const chave of chaves) {
    const form = new FormData();
    form.append("file", new Blob([dados], { type: tipo }), `audio.${extensao}`);
    form.append("model", env.WHISPER_MODELO || "whisper-large-v3-turbo");
    form.append("language", "pt");
    form.append("response_format", "json");
    const r = await fetch(URL_GROQ, { method: "POST", headers: { authorization: `Bearer ${chave}` }, body: form });
    const j = await r.json().catch(() => null);
    if (r.ok && typeof j?.text === "string") return j.text.trim();
    ultimoErro = new Error(j?.error?.message || `Groq respondeu ${r.status}`);
  }
  throw ultimoErro || new Error("nenhuma chave do Groq para transcrever");
}
