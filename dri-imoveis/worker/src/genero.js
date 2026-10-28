// "a Dri" / "o Pedro": artigos e pronomes conforme o gênero escolhido para a assistente no perfil
const FEM = { a: "a", A: "A", da: "da", na: "na", pela: "pela", ela: "ela", Ela: "Ela", x: "a", uma: "uma" };
const MASC = { a: "o", A: "O", da: "do", na: "no", pela: "pelo", ela: "ele", Ela: "Ele", x: "o", uma: "um" };
export const generoDa = (conta) => (conta?.genero_assistente === "masculino" ? MASC : FEM);
