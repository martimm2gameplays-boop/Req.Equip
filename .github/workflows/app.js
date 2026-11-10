import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth, OAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, where, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

/*
 * CONFIGURAÇÃO OBRIGATÓRIA:
 * Substitui os valores abaixo pelos dados da aplicação Web Firebase da EPBJC.
 * Nunca coloques aqui Client Secrets da Microsoft ou service-account.json.
 */
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCQokGzmwTOJpiqgHxrZaxW0ESaKR1ybyU",
  authDomain: "epbjc-teste.firebaseapp.com",
  projectId: "epbjc-teste",
  storageBucket: "epbjc-teste.firebasestorage.app",
  messagingSenderId: "748150570601",
  appId: "1:748150570601:web:b1c7cff67632cb334eecf8",
  measurementId: "G-E063QBMQFS"
};

const configured = !Object.values(firebaseConfig).some(value => String(value).startsWith("SUBSTITUIR"));
const $ = (id) => document.getElementById(id);
const loginButton = $("login-button");
const logoutButton = $("logout-button");
const authMessage = $("auth-message");
const userLabel = $("user-label");
const appContent = $("app-content");
const notice = $("notice");
const form = $("request-form");
const submitButton = $("submit-button");
const requestDate = $("request-date");
const returnDate = $("return-date");
const requestList = $("requests-list");

let auth;
let db;
let currentUser = null;

function showNotice(message, type = "") {
  notice.textContent = message;
  notice.className = `notice ${type}`.trim();
  notice.hidden = false;
}
function hideNotice() { notice.hidden = true; }
function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}
requestDate.value = localDateString();
returnDate.value = localDateString();
requestDate.min = localDateString();
returnDate.min = localDateString();
requestDate.addEventListener("change", () => { returnDate.min = requestDate.value; if (returnDate.value < requestDate.value) returnDate.value = requestDate.value; });

if (!configured) {
  $("setup-warning").hidden = false;
  loginButton.disabled = true;
  loginButton.textContent = "Configuração Firebase em falta";
  authMessage.textContent = "O site está preparado, mas ainda falta inserir a configuração real do projeto Firebase.";
} else {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

  loginButton.addEventListener("click", async () => {
    hideNotice();
    try {
      const provider = new OAuthProvider("microsoft.com");
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (error) {
      showNotice(errorMessage(error), "error");
    }
  });

  logoutButton.addEventListener("click", async () => {
    try { await signOut(auth); hideNotice(); }
    catch (error) { showNotice(errorMessage(error), "error"); }
  });

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    const signedIn = Boolean(user);
    loginButton.hidden = signedIn;
    logoutButton.hidden = !signedIn;
    userLabel.hidden = !signedIn;
    appContent.hidden = !signedIn;
    if (!signedIn) {
      authMessage.textContent = "Inicia sessão para aceder ao formulário e ao histórico dos teus pedidos.";
      userLabel.textContent = "";
      requestList.innerHTML = '<p class="muted">Inicia sessão para consultar os teus pedidos.</p>';
      return;
    }
    userLabel.textContent = user.email || "Conta Microsoft";
    authMessage.textContent = "Sessão iniciada. Os teus pedidos estão associados à tua conta.";
    await loadRequests();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideNotice();
    if (!currentUser) return showNotice("Tens de iniciar sessão antes de enviar uma requisição.", "error");
    const equipment = $("equipment").value;
    const dataPedido = requestDate.value;
    const devolucaoPrevista = returnDate.value;
    const observacoes = $("notes").value.trim();
    if (!equipment || !dataPedido || !devolucaoPrevista) return showNotice("Preenche os campos obrigatórios.", "error");
    if (devolucaoPrevista < dataPedido) return showNotice("A data de devolução tem de ser igual ou posterior à data do pedido.", "error");
    if (observacoes.length > 500) return showNotice("As observações não podem exceder 500 caracteres.", "error");

    submitButton.disabled = true;
    submitButton.textContent = "A enviar…";
    try {
      const email = (currentUser.email || "").toLowerCase();
      if (!email) throw new Error("A conta autenticada não devolveu um email. Contacta a professora.");
      const codigo = `REQ-${dataPedido.replaceAll("-", "")}-${crypto.randomUUID().slice(0,4).toUpperCase()}`;
      await addDoc(collection(db, "requisicoes"), {
        codigo,
        uid: currentUser.uid,
        email,
        requisitante: currentUser.displayName || email,
        equipamento,
        dataPedido,
        devolucaoPrevista,
        estado: "Pendente",
        observacoes,
        criadoEm: serverTimestamp()
      });
      form.reset();
      requestDate.value = localDateString();
      returnDate.value = localDateString();
      requestDate.min = localDateString();
      returnDate.min = requestDate.value;
      showNotice("Requisição enviada com sucesso. O estado inicial é Pendente.", "success");
      await loadRequests();
    } catch (error) {
      showNotice(errorMessage(error), "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Enviar requisição";
    }
  });
}

async function loadRequests() {
  if (!currentUser || !db) return;
  requestList.innerHTML = '<p class="muted">A carregar pedidos…</p>';
  try {
    const q = query(collection(db, "requisicoes"), where("uid", "==", currentUser.uid), orderBy("criadoEm", "desc"));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      requestList.innerHTML = '<p class="muted">Ainda não tens requisições. Os teus pedidos aparecerão aqui depois de enviares o primeiro.</p>';
      return;
    }
    requestList.replaceChildren();
    snapshot.forEach((docSnap) => {
      const item = docSnap.data();
      const card = document.createElement("article");
      card.className = "request-card";
      const top = document.createElement("div");
      top.className = "request-card-top";
      const left = document.createElement("div");
      const title = document.createElement("h3");
      title.textContent = item.equipamento || "Equipamento";
      const code = document.createElement("p");
      code.className = "request-meta";
      code.textContent = item.codigo || docSnap.id;
      left.append(title, code);
      const state = document.createElement("span");
      state.className = "state" + (item.estado === "Devolvido" ? " done" : item.estado === "Recusado" ? " rejected" : "");
      state.textContent = item.estado || "Pendente";
      top.append(left, state);
      const dates = document.createElement("p");
      dates.className = "request-meta";
      dates.textContent = `Pedido: ${item.dataPedido || "—"} · Devolução prevista: ${item.devolucaoPrevista || "—"}`;
      card.append(top, dates);
      if (item.observacoes) {
        const notes = document.createElement("p");
        notes.className = "request-meta";
        notes.textContent = `Observações: ${item.observacoes}`;
        card.append(notes);
      }
      requestList.append(card);
    });
  } catch (error) {
    requestList.innerHTML = '<p class="muted">Não foi possível carregar o histórico.</p>';
    showNotice(errorMessage(error), "error");
  }
}

function errorMessage(error) {
  const code = error?.code || "";
  const messages = {
    "auth/unauthorized-domain": "Este domínio ainda não está autorizado no Firebase Authentication. Adiciona o domínio do GitHub Pages nas definições do Firebase.",
    "auth/popup-blocked": "O navegador bloqueou a janela de autenticação. Permite popups para este site e tenta novamente.",
    "auth/popup-closed-by-user": "A janela de autenticação foi fechada antes de terminar.",
    "permission-denied": "Acesso recusado pelas regras Firestore. Confirma a lista authorizedUsers, active=true, email verificado e as regras de segurança.",
    "failed-precondition": "O Firestore pode precisar de um índice para esta consulta. Abre o link indicado na consola do navegador para criar o índice necessário."
  };
  return messages[code] || `Ocorreu um erro (${code || "sem código"}). Abre a consola do navegador para consultar os detalhes e confirma a configuração Firebase.`;
}
