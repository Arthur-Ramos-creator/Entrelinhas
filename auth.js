/* Supabase Auth gate. The dashboard is never exposed until a real session exists. */
(() => {
  const db = window.BookClubDB;
  const form = document.querySelector("#gate-auth-form");
  const errorBox = document.querySelector("#gate-error");
  const submitButton = document.querySelector("#gate-submit");
  const inviteKey = "entrelinhas-pending-invite-v1";
  const localAdminSessionKey = "entrelinhas-local-admin-session-v1";
  let mode = "signin";
  let busy = false;
  let onAuthenticated = () => {};
  let onSignedOut = () => {};

  function isLocalDevelopment() {
    return location.protocol === "file:"
      || location.hostname === "localhost"
      || location.hostname === "127.0.0.1";
  }

  function setMode(nextMode) {
    mode = nextMode;
    const signingUp = mode === "signup";
    document.querySelectorAll(".signup-only").forEach((field) => {
      field.hidden = !signingUp;
      const input = field.querySelector("input");
      input.required = signingUp && input.id !== "gate-invite";
      input.disabled = !signingUp;
    });
    document.querySelectorAll("[data-auth-mode]").forEach((tab) => {
      const selected = tab.dataset.authMode === mode;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
    });
    document.querySelector("#gate-title").textContent = signingUp
      ? "Sua próxima história começa aqui."
      : "Toda grande jornada começa com uma página.";
    const identifier = document.querySelector("#gate-email");
    document.querySelector("#gate-identifier-label").textContent = signingUp ? "E-mail" : "E-mail ou nome de usuário";
    identifier.type = signingUp ? "email" : "text";
    identifier.autocomplete = signingUp ? "email" : "username";
    identifier.placeholder = signingUp ? "voce@email.com" : "voce@email.com ou @seuusuario";
    identifier.inputMode = signingUp ? "email" : "text";
    const passwordInput = document.querySelector("#gate-password");
    passwordInput.autocomplete = signingUp ? "new-password" : "current-password";
    passwordInput.minLength = signingUp ? 8 : 1;
    passwordInput.placeholder = signingUp ? "Mínimo de 8 caracteres" : "Sua senha";
    submitButton.innerHTML = signingUp
      ? 'Criar minha conta <svg class="icon"><use href="#i-arrow" /></svg>'
      : 'Entrar no clube <svg class="icon"><use href="#i-arrow" /></svg>';
    document.querySelector("#gate-error").textContent = "";
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    errorBox.textContent = "";
    busy = true;
    submitButton.disabled = true;
    try {
      const identifier = document.querySelector("#gate-email").value.trim();
      const password = document.querySelector("#gate-password").value;
      if (mode === "signup") {
        const result = await registrarUsuario({
          email: identifier,
          password,
          nome: document.querySelector("#gate-name").value.trim(),
          username: document.querySelector("#gate-username").value.trim().replace(/^@/, "").toLowerCase(),
          codigoConvite: document.querySelector("#gate-invite").value.trim().toUpperCase()
        });
        if (result.confirmationRequired) {
          errorBox.textContent = "Conta criada! Confirme seu e-mail e depois entre para acessar o clube.";
          return;
        }
        await onAuthenticated(result.user);
      } else {
        await fazerLogin(identifier, password);
      }
      form.reset();
      setMode("signin");
    } catch (error) {
      errorBox.textContent = error.message || "Não foi possível acessar sua conta.";
    } finally {
      busy = false;
      submitButton.disabled = false;
    }
  }

  async function initialize(callbacks) {
    onAuthenticated = callbacks.onAuthenticated;
    onSignedOut = callbacks.onSignedOut;
    setMode("signin");
    document.querySelectorAll("[data-auth-mode]").forEach((tab) => {
      tab.addEventListener("click", () => setMode(tab.dataset.authMode));
    });
    form.addEventListener("submit", handleSubmit);
    document.querySelector("#gate-invite").addEventListener("input", (event) => {
      event.target.value = event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase();
    });
    document.querySelector("#signout-button").addEventListener("click", async () => {
      try {
        await fazerLogout();
      } catch (error) {
        callbacks.showToast(error.message || "Não foi possível encerrar a sessão.", true);
      }
    });

    if (!db.isConfigured) {
      document.querySelector("#gate-setup-note").hidden = false;
      document.querySelector("#gate-demo-credentials").hidden = !isLocalDevelopment();
      submitButton.disabled = false;
      if (isLocalDevelopment() && localStorage.getItem(localAdminSessionKey) === "active") {
        await onAuthenticated(db.createLocalAdminUser());
      }
      return;
    }
    db.client.auth.onAuthStateChange((event, session) => {
      window.setTimeout(() => {
        if (event === "SIGNED_OUT" || !session?.user) {
          onSignedOut();
        } else {
          onAuthenticated(session.user).catch((error) => {
            errorBox.textContent = error.message || "Não foi possível carregar seu perfil.";
            onSignedOut();
          });
        }
      }, 0);
    });
  }

  async function registrarUsuario({ email, password, nome, username, codigoConvite = "" }) {
    if (!db.isConfigured) throw new Error("Configure o Supabase para cadastrar uma conta.");
    if (!nome || !/^[a-z0-9_]{3,30}$/i.test(username)) {
      throw new Error("Informe seu nome completo e um nome de usuário válido (3 a 30 letras, números ou _).");
    }
    if (password.length < 8) throw new Error("A senha deve ter pelo menos 8 caracteres.");
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.replace(/^@/, "").trim().toLowerCase();
    const inviteCode = codigoConvite.trim().toUpperCase();
    if (inviteCode) {
      try {
        localStorage.setItem(inviteKey, JSON.stringify({ email: normalizedEmail, code: inviteCode }));
      } catch (storageError) {
        throw new Error(`Não foi possível guardar o convite até confirmar seu e-mail: ${storageError.message}`);
      }
    }
    try {
      const result = await db.signUp(nome, normalizedUsername, normalizedEmail, password);
      if (result.user && !result.confirmationRequired && db.client) {
        const { error } = await db.client.rpc("ensure_club_profile", {
          p_name: nome,
          p_username: normalizedUsername,
          p_email: normalizedEmail,
          p_avatar_url: ""
        });
        if (error) throw error;
      }
      return result;
    } catch (error) {
      if (inviteCode) discardPendingInvite(normalizedEmail, inviteCode);
      throw error;
    }
  }

  async function fazerLogin(emailOuUsername, password) {
    const identifier = String(emailOuUsername || "").trim();
    if (!db.isConfigured && isLocalDevelopment()
      && identifier.replace(/^@/, "").toLowerCase() === "admin"
      && password === "admin") {
      const user = db.createLocalAdminUser();
      try {
        localStorage.setItem(localAdminSessionKey, "active");
      } catch (error) {
        throw new Error(`Não foi possível iniciar o perfil local de teste: ${error.message}`);
      }
      await onAuthenticated(user);
      return user;
    }
    if (!db.isConfigured) throw new Error("Configure o Supabase para entrar com uma conta real.");
    const user = identifier.includes("@")
      ? await db.signIn(identifier, password)
      : await db.signInWithUsername(identifier, password);
    await onAuthenticated(user);
    return user;
  }

  async function fazerLogout() {
    if (db.isConfigured) await db.signOut();
    db.clearSessionData();
    onSignedOut();
  }

  function getPendingInvite(email) {
    try {
      const pending = JSON.parse(localStorage.getItem(inviteKey) || "null");
      if (!pending || pending.email.toLowerCase() !== String(email || "").toLowerCase()) return null;
      return pending.code;
    } catch (error) {
      throw new Error(`Não foi possível recuperar o convite de clube: ${error.message}`);
    }
  }

  function discardPendingInvite(email, code) {
    try {
      const pending = JSON.parse(localStorage.getItem(inviteKey) || "null");
      if (pending?.email?.toLowerCase() === String(email || "").toLowerCase() && pending.code === code) {
        localStorage.removeItem(inviteKey);
      }
    } catch (error) {
      throw new Error(`Não foi possível remover um convite de cadastro não concluído: ${error.message}`);
    }
  }

  window.BookClubAuth = Object.freeze({
    initialize,
    registrarUsuario,
    fazerLogin,
    fazerLogout,
    getPendingInvite,
    clearPendingInvite: () => localStorage.removeItem(inviteKey)
  });
  window.registrarUsuario = registrarUsuario;
  window.fazerLogin = fazerLogin;
  window.fazerLogout = fazerLogout;
})();
