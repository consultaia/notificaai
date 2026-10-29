// Conexão do WhatsApp de uma conta (app da Meta do próprio corretor). Usada pelo corretor no painel
// e pelo administrador quando faz a conexão por ele (pedido de conexão assistida).
import { lerNumero, assinarWaba, registrarNumero } from "./whatsapp.js";

const aleatorio = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
const soNumeros = (v) => String(v || "").replace(/\D/g, "");

// Endereço de webhook e token de verificação da conta (criados uma vez)
export async function prepararConexao(db, contaId) {
  const { data } = await db.from("whatsapp_conexoes").select("*").eq("conta_id", contaId).maybeSingle();
  if (data?.webhook_chave && data?.verify_token) return data;
  const novo = { conta_id: contaId, webhook_chave: aleatorio(16), verify_token: aleatorio(12) };
  const r = await db.from("whatsapp_conexoes").upsert(novo, { onConflict: "conta_id" }).select().single();
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

// Confere os dados com a Meta, liga a conta do WhatsApp Business ao app, ativa o número (PIN) e guarda.
// Devolve { erro } ou { ok, numero, nome }.
export async function conectarWhatsApp(env, db, contaId, corpo) {
  const phone_number_id = soNumeros(corpo.phone_number_id), waba_id = soNumeros(corpo.waba_id);
  const access_token = String(corpo.access_token || "").trim(), app_secret = String(corpo.app_secret || "").trim().toLowerCase();
  const pin = soNumeros(corpo.pin);
  if (!phone_number_id || !waba_id || !access_token || !app_secret)
    return { erro: "Preencha os quatro campos: ID do número, ID da conta do WhatsApp Business, token e chave secreta do app." };
  if (!/^[a-f0-9]{32}$/.test(app_secret))
    return { erro: "A chave secreta do app tem 32 letras e números (de 0 a 9 e de a a f). Confira em Configurações do app → Básico." };
  if (corpo.pin && pin.length !== 6) return { erro: "O PIN precisa ter 6 números." };
  await prepararConexao(db, contaId);

  let numero;
  try { numero = await lerNumero(env, access_token, phone_number_id); }
  catch (e) { return { erro: `A Meta não aceitou o token ou o ID do número: ${e.message}. Confira se copiou o ID do número (não o número de telefone) e se o token tem as permissões whatsapp_business_messaging e whatsapp_business_management.` }; }
  try { await assinarWaba(env, access_token, waba_id); }
  catch (e) { return { erro: `Não consegui ligar a conta do WhatsApp Business ao seu app: ${e.message}. Confira o ID da conta (WABA) e se o usuário do sistema tem acesso a ela.` }; }
  if (pin) {
    try { await registrarNumero(env, access_token, phone_number_id, pin); }
    catch (e) { return { erro: `Não consegui ativar o número na API: ${e.message}. Se o número já tinha verificação em duas etapas, use o mesmo PIN.` }; }
  }
  const r2 = await db.from("whatsapp_segredos").upsert({ conta_id: contaId, access_token, app_secret, atualizado_em: new Date().toISOString() });
  if (r2.error) throw new Error(r2.error.message);
  const r1 = await db.from("whatsapp_conexoes").update({
    phone_number_id, waba_id, numero_exibicao: numero.display_phone_number || null, detalhe: numero.verified_name || null,
    status: "conectado", conectado_em: new Date().toISOString(),
  }).eq("conta_id", contaId);
  if (r1.error) return { erro: r1.error.code === "23505" ? "Esse número já está ligado a outra conta do Toc Toc." : r1.error.message };
  return { ok: true, numero: numero.display_phone_number, nome: numero.verified_name };
}
