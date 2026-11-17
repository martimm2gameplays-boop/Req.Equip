import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  OAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// Configuração da aplicação Web Firebase.
const firebaseConfig = {
  apiKey: "AIzaSyCQokGzmwTOJpiqgHxrZaxW0ESaKR1ybyU",
  authDomain: "epbjc-teste.firebaseapp.com",
  projectId: "epbjc-teste",
  storageBucket: "epbjc-teste.firebasestorage.app",
  messagingSenderId: "748150570601",
  appId: "1:748150570601:web:b1c7cff67632cb334eecf8",
  measurementId: "G-E063QBMQFS"
};

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

let auth = null;
let db = null;
let currentUser = null;

function showNotice(message, type = "") {
  notice.textContent = message;
  notice.className = `notice ${type}`.trim();
  notice.hidden = false;
}

function hideNotice() {
  notice.hidden = true;
}

function localDateString(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function setDefaultDates() {
  const today = localDateString();
  requestDate.value = today;
  returnDate.value = today;
  requestDate.min = today;
  returnDate.min = requestDate.value;
}

function errorMessage(error) {
  const code = error?.code || "";
  const messages = {
    "auth/unauthorized-domain": "Este domínio ainda não está autorizado no Firebase Authentication. Adiciona alunos.epbjc.pt em Authentication → Settings → Authorized domains.",
    "auth/popup-blocked": "O navegador bloqueou a janela de autenticação. Permite pop-ups para este site e tenta novamente.",
    "auth/popup-closed-by-user": "A janela de autenticação foi fechada antes de terminar.",
    "auth/account-exists-with-different-credential": "Já existe uma conta com este email através de outro método de autenticação.",
    "auth/operation-not-allowed": "O fornecedor Microsoft não está ativado no Firebase Authentication.",
    "permission-denied": "Acesso recusado pelas regras Firestore. Confirma o email, email verificado e o documento authorizedUsers com active=true.",
    "failed-precondition": "O Firestore pode precisar de um índice para esta consulta. Consulta a ligação apresentada na consola do navegador."
  };

  return messages[code] || `Ocorreu um erro (${code || error?.message || "sem código"}). Abre a consola do navegador (F12) para consultar os detalhes.`;
}

// Datas iniciais do formulário.
setDefaultDates();
requestDate.addEventListener("change", () => {
  returnDate.min = requestDate.value;
  if (returnDate.value < requestDate.value) {
    returnDate.value = requestDate.value;
  }
});

// Inicialização do Firebase.
try {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (error) {
  console.error("Erro ao inicializar Firebase:", error);
  loginButton.disabled = true;
  authMessage.textContent = "Não foi possível inicializar o Firebase. Confirma a configuração da aplicação.";
  showNotice(errorMessage(error), "error");
}

if (auth && db) {
  // LOGIN MICROSOFT
  loginButton.addEventListener("click", async () => {
    hideNotice();
    loginButton.disabled = true;
    loginButton.textContent = "A iniciar sessão…";

    try {
      const provider = new OAuthProvider("microsoft.com");
      provider.setCustomParameters({
        prompt: "select_account",
        tenant: "4334e4b0-48f4-4a76-ae54-cec847437a72"
      });

      // Esta chamada é que abre a janela de autenticação Microsoft.
      const result = await signInWithPopup(auth, provider);
      const email = (result.user.email || "").toLowerCase();

      if (!email.endsWith("@alunos.epbjc.pt")) {
        await signOut(auth);
        showNotice("Utiliza a tua conta institucional com o domínio @alunos.epbjc.pt.", "error");
      }
    } catch (error) {
      console.error("Erro no login Microsoft:", error);
      showNotice(errorMessage(error), "error");
    } finally {
      loginButton.disabled = false;
      loginButton.textContent = "Entrar com Microsoft";
    }
  });

  // LOGOUT
  logoutButton.addEventListener("click", async () => {
    try {
      await signOut(auth);
      hideNotice();
    } catch (error) {
      console.error("Erro ao terminar sessão:", error);
      showNotice(errorMessage(error), "error");
    }
  });

  // ESTADO DA AUTENTICAÇÃO
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

    const email = (user.email || "").toLowerCase();
    if (!email.endsWith("@alunos.epbjc.pt")) {
      try {
        await signOut(auth);
      } catch (error) {
        console.error("Erro ao terminar sessão de conta não institucional:", error);
      }
      showNotice("Utiliza a tua conta institucional com o domínio @alunos.epbjc.pt.", "error");
      return;
    }

    userLabel.textContent = user.email || "Conta Microsoft";
    authMessage.textContent = "Sessão iniciada. Os teus pedidos estão associados à tua conta.";
    await loadRequests();
  });

  // ENVIAR REQUISIÇÃO
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideNotice();

    if (!currentUser) {
      showNotice("Tens de iniciar sessão antes de enviar uma requisição.", "error");
      return;
    }

    const equipment = $("equipment").value;
    const dataPedido = requestDate.value;
    const devolucaoPrevista = returnDate.value;
    const observacoes = $("notes").value.trim();
    const email = (currentUser.email || "").toLowerCase();

    if (!email.endsWith("@alunos.epbjc.pt")) {
      showNotice("Utiliza a tua conta institucional EPBJC.", "error");
      return;
    }
    if (!equipment || !dataPedido || !devolucaoPrevista) {
      showNotice("Preenche os campos obrigatórios.", "error");
      return;
    }
    if (devolucaoPrevista < dataPedido) {
      showNotice("A data de devolução tem de ser igual ou posterior à data do pedido.", "error");
      return;
    }
    if (observacoes.length > 500) {
      showNotice("As observações não podem exceder 500 caracteres.", "error");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "A enviar…";

    try {
      const codigo = `REQ-${Date.now()}`;

      await addDoc(collection(db, "requisicoes"), {
        codigo,
        uid: currentUser.uid,
        email,
        requisitante: currentUser.displayName || email,
        equipamento: equipment,
        dataPedido,
        devolucaoPrevista,
        estado: "Pendente",
        observacoes,
        criadoEm: serverTimestamp()
      });

      form.reset();
      setDefaultDates();
      showNotice("Requisição enviada com sucesso. O estado inicial é Pendente.", "success");
      await loadRequests();
    } catch (error) {
      console.error("Erro ao enviar requisição:", error);
      showNotice(errorMessage(error), "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Enviar requisição";
    }
  });
}

// CARREGAR HISTÓRICO DO ALUNO
async function loadRequests() {
  if (!currentUser || !db) return;

  requestList.innerHTML = '<p class="muted">A carregar pedidos…</p>';

  try {
    const requestsQuery = query(
      collection(db, "requisicoes"),
      where("uid", "==", currentUser.uid),
      orderBy("criadoEm", "desc")
    );

    const snapshot = await getDocs(requestsQuery);

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
      state.className = "state" + (
        item.estado === "Devolvido" ? " done" :
        item.estado === "Recusado" ? " rejected" : ""
      );
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
    console.error("Erro ao carregar requisições:", error);
    requestList.innerHTML = '<p class="muted">Não foi possível carregar o histórico.</p>';
    showNotice(errorMessage(error), "error");
  }
}
