async function fazerLogin() {
  const usuario = document.getElementById("usuario").value.trim();
  const senha = document.getElementById("senha").value.trim();

  const resposta = await fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario, senha })
  });

  const resultado = await resposta.json();

  if (resultado.sucesso) {
    // Armazena o tipo de usuário e o nome no localStorage
    localStorage.setItem("tipoUsuario", resultado.tipo);
    localStorage.setItem("usuario", usuario); // ← ESSENCIAL para outras telas saberem quem está logado

    window.location.href = "dashboard.html";
  } else {
    document.getElementById("erro").textContent = resultado.mensagem;
  }
}
