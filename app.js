(() => {
  const db = window.BookClubDB;
  const $ = (selector) => document.querySelector(selector);
  const state = { data: null, user: null, filter: "all", query: "", loadingUserId: null, loadingPromise: null, deletingClubId: null };
  const formatPoints = (value) => new Intl.NumberFormat("pt-BR").format(Number(value) || 0);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  function showToast(message, isError = false) {
    const toast = document.createElement("div");
    toast.className = `toast${isError ? " error" : ""}`;
    toast.setAttribute("role", isError ? "alert" : "status");
    toast.textContent = message;
    $("#toast-region").append(toast);
    window.setTimeout(() => toast.remove(), 3600);
  }

  function renderProfile() {
    const { profile, mission } = state.data;
    const name = typeof profile.name === "string" && profile.name.trim() ? profile.name : "Leitor(a)";
    const firstName = (name || "").trim().split(/\s+/)[0] || "Leitor(a)";
    const avatar = profile.avatar_url || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=160&q=80";
    $("#header-avatar").src = avatar;
    $("#header-name").textContent = firstName;
    $("#greeting-name").textContent = firstName;
    $("#profile-avatar").src = avatar;
    $("#profile-avatar").alt = `Foto de perfil de ${escapeHtml(name)}`;
    $("#profile-name").textContent = name;
    $("#profile-quote").textContent = profile.motivational_quote ? `“${profile.motivational_quote}”` : "";
    $("#profile-username").textContent = profile.username ? `@${profile.username}` : "";
    $("#profile-cover").style.backgroundImage = isImageUrl(profile.cover_url)
      ? `linear-gradient(90deg, rgba(0,0,0,.4), rgba(0,0,0,.05)), url("${escapeCssUrl(profile.cover_url)}")`
      : "";
    $("#profile-bio").textContent = profile.bio || "Adicione uma pequena apresentação ao seu perfil.";
    $("#favorite-genres").innerHTML = (profile.favorite_genres || []).map((genre) => `<span>${escapeHtml(genre)}</span>`).join("")
      || '<span class="genre-placeholder">Escolha seus gêneros favoritos</span>';
    const socialLinks = profile.social_links || {};
    $("#profile-socials").innerHTML = Object.entries(socialLinks)
      .filter(([, url]) => /^https?:\/\//i.test(url || ""))
      .map(([network, url]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(network)}</a>`)
      .join("");
    $("#books-read").textContent = formatPoints(profile.books_read);
    $("#total-points").textContent = formatPoints(profile.total_points);
    $("#streak-count").textContent = formatPoints(profile.streak);
    $("#level-number").textContent = profile.level;
    $("#ring-level-number").textContent = profile.level;
    $("#xp-current").textContent = formatPoints(profile.xp);
    $("#xp-target").textContent = formatPoints(profile.xp_target);
    const target = Math.max(1, Number(profile.xp_target) || 500);
    const xp = Math.max(0, Number(profile.xp) || 0);
    const xpPercent = Math.min(100, Math.round((xp / target) * 100));
    const remaining = Math.max(0, target - xp);
    $("#xp-remaining").textContent = `${formatPoints(remaining)} XP restantes`;
    $("#xp-bar").style.width = `${xpPercent}%`;
    const levelPercent = Math.min(99, Math.round((xp / target) * 100));
    $("#level-percent").innerHTML = `${levelPercent}<span>%</span>`;
    $("#level-ring").style.background = `conic-gradient(var(--gold) 0deg ${levelPercent * 3.6}deg, var(--ring-muted) ${levelPercent * 3.6}deg 360deg)`;
    $("#level-ring").setAttribute("aria-label", `Progresso do nível: ${levelPercent}%`);
    const book = state.data.currentBook;
    const hasBook = Boolean(book);
    $("#current-book-title").textContent = book?.title || "Seu clube ainda não escolheu um livro.";
    $("#current-book-author").textContent = book?.author ? `por ${book.author}` : "";
    $("#current-book-description").textContent = book?.description || (hasBook ? "Compartilhe suas impressões e acompanhe sua leitura junto com o clube." : "Assim que o administrador adicionar a leitura da semana, ela aparecerá aqui.");
    $("#current-book-deadline").textContent = book?.week_ends ? formatDate(book.week_ends) : (hasBook ? "Prazo não definido" : "Aguardando leitura do clube");
    $("#current-book-club").textContent = hasBook ? (state.data.clubs.find((club) => club.id === state.data.selectedClubId)?.name || "LIVRO DA SEMANA").toLocaleUpperCase("pt-BR") : "LIVRO DA\nSEMANA";
    $("#current-book-cover-title").textContent = hasBook ? book.title.toLocaleUpperCase("pt-BR") : "AGUARDANDO\nUMA LEITURA";
    $("#current-book-cover-author").textContent = hasBook ? book.author.toLocaleUpperCase("pt-BR") : "O ADMINISTRADOR VAI ESCOLHER";
    $("#current-book-image").src = isImageUrl(book?.cover_url)
      ? book.cover_url
      : (document.documentElement.dataset.theme === "light" ? "livro espera claro.jpg" : "tema escuro livro espera.jpg");
    $("#current-book-image").alt = hasBook ? `Capa de ${book.title}` : "Livros enquanto o clube escolhe sua próxima leitura";
    const progress = Number(mission.progress) || 0;
    $("#mission-percent").textContent = `${progress}%`;
    $("#mission-bar").style.width = `${progress}%`;
    $("#pages-total").textContent = formatPoints(mission.pages_read);
    $("#pages-plan").textContent = formatPoints(mission.pages_total || 0);
    $("#minutes-total").textContent = formatDuration(mission.minutes_read);
    $("#reading-form").hidden = !hasBook;
    $("#book-comment-form").hidden = !hasBook;
  }

  function formatDate(dateValue) {
    if (!dateValue) return "Sem prazo";
    const date = new Date(`${dateValue}T12:00:00`);
    if (Number.isNaN(date.getTime())) return "Sem prazo";
    return `Até ${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date).replace(".", "")}`;
  }

  function isImageUrl(value) {
    return /^https?:\/\//i.test(value || "") || /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value || "");
  }

  function escapeCssUrl(value) {
    return value.replace(/[\\")\n\r]/g, (character) => `\\${character}`);
  }

  function formatDuration(value) {
    const minutes = Math.max(0, Number(value) || 0);
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (hours && remainder) return `${hours}h ${remainder}min`;
    if (hours) return `${hours}h`;
    return `${remainder} min`;
  }

  function renderReadingHistory() {
    const history = $("#reading-history");
    const logs = state.data.readingLogs || [];
    if (!logs.length) {
      history.innerHTML = '<span class="history-empty">Seus registros recentes aparecem aqui.</span>';
      return;
    }
    history.innerHTML = `<span class="history-label">REGISTROS RECENTES</span>${logs.slice(0, 3).map((item) => {
      const mode = item.mode || item.reading_mode;
      const amount = mode === "pages"
        ? `${formatPoints(item.pages)} ${Number(item.pages) === 1 ? "página" : "páginas"}`
        : formatDuration(item.minutes);
      const date = item.logged_at ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(item.logged_at)).replace(".", "") : "";
      return `<span class="history-item"><b>${escapeHtml(amount)}</b><small>${escapeHtml(date)}</small></span>`;
    }).join("")}`;
  }

  function renderClubs() {
    const clubs = state.data.clubs || [];
    const list = $("#clubs-list");
    const pickerWrap = $("#reading-club-picker-wrap");
    const picker = $("#reading-club-picker");
    pickerWrap.hidden = clubs.length < 2;
    picker.innerHTML = clubs.map((club) => `<option value="${escapeHtml(club.id)}" ${club.id === state.data.selectedClubId ? "selected" : ""}>${escapeHtml(club.name)}</option>`).join("");
    $("#club-note").textContent = db.mode === "demo" || !state.user
      ? "Modo local: os códigos só funcionam neste navegador. Configure o Supabase e entre na conta para compartilhar com outras pessoas."
      : "Compartilhe o código do clube com quem vai ler com você.";
    if (!clubs.length) {
      list.innerHTML = `<article class="club-empty surface-card">
        <span class="club-empty-icon"><svg class="icon"><use href="#i-users" /></svg></span>
        <span class="eyebrow muted-eyebrow">AINDA SEM CLUBE</span>
        <h3>Uma boa história<br />fica ainda melhor<br />quando é compartilhada.</h3>
        <p>Crie um clube e escolha a leitura desta semana, ou entre na turma de alguém usando um código de convite.</p>
        <a class="text-action" href="#create-club-form">Criar meu primeiro clube <svg class="icon"><use href="#i-arrow" /></svg></a>
      </article>`;
      return;
    }
    list.innerHTML = clubs.map((club) => {
      const selected = club.id === state.data.selectedClubId;
      const isCreator = club.is_creator || club.creator_id === state.user?.id;
      return `<article class="club-card surface-card">
        <div class="club-card-top"><span class="club-empty-icon"><svg class="icon"><use href="#i-users" /></svg></span><span class="club-role">${isCreator ? "ADMINISTRADOR · CRIADOR" : club.role === "admin" ? "ADMINISTRADOR" : "MEMBRO"}</span></div>
        <h3>${escapeHtml(club.name)}</h3>
        <div class="club-weekly-book"><span class="eyebrow muted-eyebrow">LIVRO DA SEMANA</span><strong>${selected ? escapeHtml(state.data.currentBook?.title || "Ainda não escolhido") : "Selecione o clube para ver a leitura"}</strong></div>
        <div class="club-invite-row"><span><small>CÓDIGO DE CONVITE</small><b>${escapeHtml(club.code)}</b></span><button type="button" class="button button-outline copy-club-code" data-copy-code="${escapeHtml(club.code)}">Copiar código</button></div>
        <div class="club-card-actions">
          <button type="button" class="button ${selected ? "button-outline" : "button-gold"} select-club-button" data-select-club="${escapeHtml(club.id)}" ${selected ? "disabled" : ""}>${selected ? "Clube selecionado" : "Abrir clube"}</button>
          ${isCreator ? `<button type="button" class="button button-danger delete-club-button" data-delete-club="${escapeHtml(club.id)}">Excluir clube</button>` : ""}
        </div>
      </article>`;
    }).join("");
  }

  function renderAdmin() {
    const club = state.data.clubs.find((item) => item.id === state.data.selectedClubId);
    const isAdmin = Boolean(club?.is_admin);
    $("#admin-tools").hidden = !isAdmin;
    $("#admin-nav-link").hidden = !isAdmin;
    $("#community-role-note").textContent = club?.role === "owner"
      ? "Você criou este clube e pode promover um membro para ajudar na administração."
      : club?.role === "admin"
        ? "Você pode ajudar a escolher livros e criar atividades para o clube."
        : "Apenas administradores podem escolher livros e criar atividades.";
  }

  function renderCommunity() {
    const club = state.data.clubs.find((item) => item.id === state.data.selectedClubId);
    const members = state.data.members || [];
    $("#community-club-name").textContent = club?.name || "";
    $("#community-club-code").textContent = club?.code || "—";
    $("#member-count").textContent = `${members.length} ${members.length === 1 ? "leitor" : "leitores"}`;
    const list = $("#club-members-list");
    if (!club) {
      list.innerHTML = '<p class="empty-state">Crie ou entre em um clube para conhecer seus membros.</p>';
      return;
    }
    if (!members.length) {
      list.innerHTML = '<p class="empty-state">Ainda não há membros para exibir.</p>';
      return;
    }
    list.innerHTML = members.map((member) => {
      const memberName = member.name || member.username || "Leitor(a)";
      const canPromote = club.role === "owner" && member.role === "reader" && member.user_id !== state.user?.id;
      return `<div class="club-member-row">
        <img src="${escapeHtml(isImageUrl(member.avatar_url) ? member.avatar_url : "https://ui-avatars.com/api/?name=Leitor&background=6f412e&color=fff")}" alt="" />
        <span class="club-member-identity"><b>${escapeHtml(memberName)}</b><small>@${escapeHtml(member.username || "leitor")}</small></span>
        <span class="member-role-badge">${member.role === "owner" ? "Administrador · criador" : member.role === "admin" ? "Administrador" : "Leitor"}</span>
        ${canPromote ? `<button class="button button-outline promote-member-button" data-promote-member="${escapeHtml(member.user_id)}" type="button">Promover</button>` : ""}
      </div>`;
    }).join("");
  }

  function renderComments() {
    const comments = state.data.comments || [];
    $("#comment-count").textContent = `${comments.length} ${comments.length === 1 ? "comentário" : "comentários"}`;
    const list = $("#book-comments-list");
    if (!state.data.currentBook) {
      list.innerHTML = '<p class="empty-state">Os comentários aparecem quando o administrador escolher um livro.</p>';
      return;
    }
    if (!comments.length) {
      list.innerHTML = '<p class="empty-state">Seja a primeira pessoa a compartilhar uma impressão sobre este livro.</p>';
      return;
    }
    list.innerHTML = comments.map((comment) => {
      const name = comment.name || comment.username || "Leitor(a)";
      const date = comment.created_at ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(comment.created_at)).replace(".", "") : "";
      return `<article class="book-comment">
        <img src="${escapeHtml(isImageUrl(comment.avatar_url) ? comment.avatar_url : "https://ui-avatars.com/api/?name=Leitor&background=6f412e&color=fff")}" alt="" />
        <div><div class="comment-author"><b>${escapeHtml(name)}</b><span>@${escapeHtml(comment.username || "leitor")}</span><time>${escapeHtml(date)}</time></div><p>${escapeHtml(comment.body)}</p></div>
      </article>`;
    }).join("");
  }

  function activityStatus(activity) {
    if (activity.completed) return { label: "Concluída", className: "completed", progress: 100 };
    const progress = Math.min(99, Math.max(0, Number(activity.progress) || 0));
    return progress > 0
      ? { label: "Em andamento", className: "in-progress", progress }
      : { label: "Não iniciado", className: "", progress };
  }

  function renderActivities() {
    const all = state.data.activities || [];
    const completed = all.filter((activity) => activity.completed).length;
    $("#count-all").textContent = String(all.length).padStart(2, "0");
    $("#count-completed").textContent = String(completed).padStart(2, "0");
    $("#count-pending").textContent = String(all.length - completed).padStart(2, "0");
    $("#activity-count").textContent = String(all.length).padStart(2, "0");
    const filtered = all.filter((activity) => {
      const matchesFilter = state.filter === "all" || (state.filter === "completed" ? activity.completed : !activity.completed);
      const haystack = `${activity.title} ${activity.description} ${activity.category}`.toLocaleLowerCase("pt-BR");
      return matchesFilter && haystack.includes(state.query.toLocaleLowerCase("pt-BR"));
    });
    const grid = $("#activity-grid");
    if (!filtered.length) {
      grid.innerHTML = all.length
        ? '<div class="empty-state">Nenhuma atividade encontrada. Tente outro filtro ou termo de busca.</div>'
        : '<div class="empty-state">Ainda não há atividades neste clube. O administrador pode criar uma na área de ferramentas.</div>';
      return;
    }
    grid.innerHTML = filtered.map((activity) => {
      const status = activityStatus(activity);
      const progressText = status.progress > 0 ? `${status.progress}%` : "—";
      const action = activity.completed
        ? '<button class="activity-action" type="button" disabled>Concluída <svg class="icon"><use href="#i-check" /></svg></button>'
        : `<button class="activity-action" type="button" data-complete="${escapeHtml(activity.id)}">Marcar como concluída <svg class="icon"><use href="#i-arrow" /></svg></button>`;
      return `<article class="activity-card">
        <div class="activity-visual"><img src="${escapeHtml(activity.image || "https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=700&q=80")}" alt="" loading="lazy" /><span class="activity-label">${escapeHtml(activity.category || "LEITURA")}</span><span class="activity-status ${status.className}">${status.label}</span></div>
        <div class="activity-content"><h3>${escapeHtml(activity.title)}</h3><p class="activity-description">${escapeHtml(activity.description)}</p>
        <div class="activity-meta"><span><svg class="icon"><use href="#i-calendar" /></svg>${escapeHtml(formatDate(activity.due_date))}</span><span class="activity-points">+${formatPoints(activity.points)} pts</span></div>
        <div class="activity-progress-line"><div class="progress-track"><span style="width:${status.progress}%"></span></div><small>${progressText}</small></div>${action}</div>
      </article>`;
    }).join("");
  }

  function render() {
    renderProfile();
    renderActivities();
    renderReadingHistory();
    renderClubs();
    renderAdmin();
    renderCommunity();
    renderComments();
    document.body.dataset.mode = "supabase";
    document.body.classList.add("authenticated");
  }

  async function loadForUser(user) {
    if (state.user?.id === user.id && state.data) return;
    if (state.loadingUserId === user.id && state.loadingPromise) return state.loadingPromise;
    state.user = user;
    state.loadingUserId = user.id;
    state.loadingPromise = (async () => {
      state.data = await db.loadUserData(user);
      const inviteCode = window.BookClubAuth.getPendingInvite(user.email);
      if (inviteCode) {
        try {
          state.data = await db.joinClub(user.id, inviteCode, state.data);
          window.BookClubAuth.clearPendingInvite();
          showToast("Convite aceito. Você entrou no clube!");
        } catch (error) {
          window.BookClubAuth.clearPendingInvite();
          showToast(`Sua conta foi criada, mas não foi possível usar o convite: ${error.message}`, true);
        }
      }
      applyTheme(state.data.profile.preferred_theme || "dark", false);
      render();
      const displayName = typeof state.data.profile.name === "string" ? state.data.profile.name : "";
      showToast(`Que bom ter você no clube, ${(displayName || "").split(/\s+/)[0] || "leitor(a)"}!`);
    })();
    try {
      await state.loadingPromise;
    } finally {
      state.loadingUserId = null;
      state.loadingPromise = null;
    }
  }

  function applyTheme(theme, persist = false) {
    const selectedTheme = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = selectedTheme;
    document.body.setAttribute("data-theme", selectedTheme);
    document.documentElement.style.colorScheme = selectedTheme;
    if (!state.data?.currentBook?.cover_url) {
      $("#current-book-image").src = selectedTheme === "light" ? "livro espera claro.jpg" : "tema escuro livro espera.jpg";
    }
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const isLight = selectedTheme === "light";
      button.setAttribute("aria-label", isLight ? "Alternar para tema escuro" : "Alternar para tema claro");
      button.title = isLight ? "Ativar tema escuro" : "Ativar tema claro";
      const icon = button.querySelector(".theme-icon use");
      if (icon) icon.setAttribute("href", isLight ? "#i-moon" : "#i-sun");
      const label = button.querySelector("span");
      if (label) label.textContent = isLight ? "Modo escuro" : "Modo claro";
    });
    try {
      localStorage.setItem("entrelinhas-theme-v1", selectedTheme);
    } catch (error) {
      showToast(`Não foi possível salvar o tema neste navegador: ${error.message}`, true);
    }
    if (persist && state.data && state.user) {
      db.saveTheme(state.user.id, state.data, selectedTheme)
        .then((data) => { state.data = data; })
        .catch((error) => showToast(error.message || "Não foi possível salvar sua preferência de tema.", true));
    }
  }

  function clearSession() {
    state.data = null;
    state.user = null;
    document.body.classList.remove("authenticated");
    $("#profile-dialog").close();
    $("#gate-error").textContent = "";
  }

  function openDetails(title, message) {
    $("#detail-title").textContent = title;
    $("#detail-copy").textContent = message;
    $("#detail-dialog").showModal();
  }

  document.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.filter = tab.dataset.filter;
      document.querySelectorAll(".filter-tab").forEach((item) => {
        const selected = item === tab;
        item.classList.toggle("active", selected);
        item.setAttribute("aria-selected", String(selected));
      });
      renderActivities();
    });
  });

  $("#activity-search").addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    renderActivities();
  });

  $("#activity-grid").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-complete]");
    if (!button || button.disabled) return;
    const activity = state.data.activities.find((item) => String(item.id) === button.dataset.complete);
    if (!activity || activity.completed) return;
    button.disabled = true;
    const card = button.closest(".activity-card");
    const status = card.querySelector(".activity-status");
    status.textContent = "Concluída";
    status.classList.add("completed");
    card.querySelector(".activity-progress-line .progress-track > span").style.width = "100%";
    card.querySelector(".activity-progress-line small").textContent = "100%";
    button.innerHTML = 'Concluída <svg class="icon"><use href="#i-check" /></svg>';
    const previousData = state.data;
    try {
      const result = await window.concluirAtividade(activity.id, activity.points);
      showToast(`Atividade concluída! +${formatPoints(result.lastPointsAwarded ?? activity.points)} pontos para você. ✨`);
    } catch (error) {
      state.data = previousData;
      render();
      showToast(error.message || "Não foi possível salvar esta atividade.", true);
    }
  });

  async function concluirAtividade(activityId, pontosGanhos) {
    if (!state.user || !state.data) throw new Error("Entre na sua conta antes de concluir uma atividade.");
    state.data = await db.completeActivity(state.user.id, state.data, activityId, pontosGanhos);
    render();
    return state.data;
  }
  window.concluirAtividade = concluirAtividade;

  $("#reading-mode").addEventListener("change", (event) => {
    const byPages = event.target.value === "pages";
    $("#reading-pages-fields").hidden = !byPages;
    $("#reading-pages").disabled = !byPages;
    $("#reading-pages").required = byPages;
    $("#reading-time-fields").hidden = byPages;
    $("#reading-hours").disabled = byPages;
    $("#reading-minutes").disabled = byPages;
  });

  $("#reading-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const mode = $("#reading-mode").value;
    const pages = Number($("#reading-pages").value);
    const hours = Number($("#reading-hours").value);
    const minutes = Number($("#reading-minutes").value);
    const totalMinutes = hours * 60 + minutes;
    if (mode === "time" && (hours < 0 || hours > 24 || minutes < 0 || minutes > 59 || (hours === 24 && minutes > 0))) {
      showToast("Informe um tempo entre 0h 1min e 24h 0min.", true);
      return;
    }
    if (mode === "time" && totalMinutes < 1) {
      showToast("Informe pelo menos um minuto de leitura.", true);
      return;
    }
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      state.data = await db.logReading(state.user?.id, state.data, {
        mode,
        pages: mode === "pages" ? pages : 0,
        minutes: mode === "time" ? totalMinutes : 0
      });
      render();
      const message = mode === "pages"
        ? `${formatPoints(pages)} ${pages === 1 ? "página registrada" : "páginas registradas"}. Boa leitura!`
        : `${formatDuration(totalMinutes)} de leitura registrados. Boa leitura!`;
      $("#reading-feedback").textContent = message;
      $("#reading-form").reset();
      $("#reading-mode").dispatchEvent(new Event("change"));
      $("#reading-hours").value = "0";
      $("#reading-minutes").value = "15";
      showToast(message);
    } catch (error) {
      showToast(error.message || "Não foi possível salvar seu registro de leitura.", true);
    } finally {
      submit.disabled = false;
    }
  });

  $("#club-code").addEventListener("input", (event) => {
    event.target.value = event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase();
  });

  $("#join-club-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      state.data = await db.joinClub(state.user?.id, $("#club-code").value, state.data);
      renderClubs();
      $("#join-club-form").reset();
      showToast(db.mode === "demo" ? "Você já está neste clube neste navegador." : "Você entrou no clube. Boa leitura em grupo!");
    } catch (error) {
      showToast(error.message || "Não foi possível entrar neste clube.", true);
    } finally {
      submit.disabled = false;
    }
  });

  $("#create-club-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      state.data = await db.createClub(state.user?.id, {
        name: $("#club-name").value
      }, state.data);
      render();
      $("#create-club-form").reset();
      const createdClub = state.data.clubs.find((club) => club.id === state.data.selectedClubId);
      showToast(`Clube criado! Seu código de convite é ${createdClub.code}.`);
    } catch (error) {
      showToast(error.message || "Não foi possível criar o clube.", true);
    } finally {
      submit.disabled = false;
    }
  });

  $("#clubs-list").addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-delete-club]");
    if (deleteButton) {
      const club = state.data.clubs.find((item) => item.id === deleteButton.dataset.deleteClub);
      if (!(club?.is_creator || club?.creator_id === state.user?.id)) {
        showToast("Somente a pessoa que criou o clube pode excluí-lo.", true);
        return;
      }
      state.deletingClubId = club.id;
      $("#delete-club-name").textContent = club.name;
      $("#delete-club-dialog").showModal();
      $("#delete-club-cancel").focus();
      return;
    }
    const selectButton = event.target.closest("[data-select-club]");
    if (selectButton && !selectButton.disabled) {
      try {
        state.data = await db.selectClub(state.user?.id, state.data, selectButton.dataset.selectClub);
        render();
      } catch (error) {
        showToast(error.message || "Não foi possível abrir este clube.", true);
      }
      return;
    }
    const copyButton = event.target.closest("[data-copy-code]");
    if (copyButton) {
      try {
        await navigator.clipboard.writeText(copyButton.dataset.copyCode);
        showToast("Código do clube copiado. Convide sua turma!");
      } catch {
        showToast(`Copie o código do convite: ${copyButton.dataset.copyCode}`);
      }
    }
  });

  $("#delete-club-close").addEventListener("click", () => {
    state.deletingClubId = null;
    $("#delete-club-dialog").close();
  });
  $("#delete-club-cancel").addEventListener("click", () => {
    state.deletingClubId = null;
    $("#delete-club-dialog").close();
  });
  $("#delete-club-confirm").addEventListener("click", async (event) => {
    const club = state.data?.clubs.find((item) => item.id === state.deletingClubId);
    if (!club) {
      $("#delete-club-dialog").close();
      state.deletingClubId = null;
      return;
    }
    const button = event.currentTarget;
    button.disabled = true;
    try {
      state.data = await db.deleteClub(state.user?.id, state.data, club.id);
      state.deletingClubId = null;
      $("#delete-club-dialog").close();
      render();
      showToast(`O clube “${club.name}” foi excluído.`);
    } catch (error) {
      showToast(error.message || "Não foi possível excluir o clube.", true);
    } finally {
      button.disabled = false;
    }
  });
  $("#delete-club-dialog").addEventListener("close", () => {
    state.deletingClubId = null;
  });

  $("#rewards-details").addEventListener("click", () => openDetails(
    "Leia no seu ritmo.",
    "Registre as páginas lidas ou o tempo dedicado ao livro da semana. Seu progresso fica salvo no clube e você pode compartilhar suas impressões nos comentários."
  ));
  $("#reading-club-picker").addEventListener("change", async (event) => {
    try {
      state.data = await db.selectClub(state.user?.id, state.data, event.target.value);
      render();
    } catch (error) {
      showToast(error.message || "Não foi possível trocar de clube.", true);
    }
  });

  document.querySelectorAll("[data-admin-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const isBookTab = tab.dataset.adminTab === "book";
      document.querySelectorAll("[data-admin-tab]").forEach((item) => {
        const selected = item === tab;
        item.classList.toggle("active", selected);
        item.setAttribute("aria-selected", String(selected));
      });
      $("#admin-book-panel").hidden = !isBookTab;
      $("#admin-task-panel").hidden = isBookTab;
    });
  });

  $("#admin-book-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      state.data = await db.addWeeklyBook(state.user?.id, state.data, {
        title: $("#admin-book-title").value,
        author: $("#admin-book-author").value,
        pages: $("#admin-book-pages").value,
        weekEnds: $("#admin-book-deadline").value,
        description: $("#admin-book-description").value
      });
      render();
      form.reset();
      $("#admin-book-pages").value = "250";
      showToast("Livro adicionado. Agora ele aparece para todos no clube!");
    } catch (error) {
      showToast(error.message || "Não foi possível adicionar o livro.", true);
    } finally {
      submit.disabled = false;
    }
  });

  $("#admin-task-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      state.data = await db.createClubTask(state.user?.id, state.data, {
        title: $("#admin-task-title").value,
        description: $("#admin-task-description").value,
        points: $("#admin-task-points").value,
        dueDate: $("#admin-task-deadline").value,
        category: $("#admin-task-category").value
      });
      render();
      form.reset();
      $("#admin-task-points").value = "20";
      $("#admin-task-category").value = "LEITURA";
      showToast("Atividade adicionada para os membros do clube.");
    } catch (error) {
      showToast(error.message || "Não foi possível criar a atividade.", true);
    } finally {
      submit.disabled = false;
    }
  });

  $("#book-comment-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      state.data = await db.addBookComment(state.user?.id, state.data, $("#book-comment-input").value);
      render();
      form.reset();
      showToast("Seu comentário foi publicado.");
    } catch (error) {
      showToast(error.message || "Não foi possível publicar o comentário.", true);
    } finally {
      submit.disabled = false;
    }
  });

  $("#club-members-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-promote-member]");
    if (!button) return;
    button.disabled = true;
    try {
      state.data = await db.promoteClubMember(state.user?.id, state.data, button.dataset.promoteMember);
      render();
      showToast("Membro promovido a administrador do clube.");
    } catch (error) {
      showToast(error.message || "Não foi possível promover este membro.", true);
    }
  });

  $("#copy-community-code").addEventListener("click", async () => {
    const code = $("#community-club-code").textContent;
    if (!code || code === "—") return;
    try {
      await navigator.clipboard.writeText(code);
      showToast("Código do clube copiado.");
    } catch {
      showToast(`Copie o código do convite: ${code}`);
    }
  });
  $("#auth-open").addEventListener("click", () => $("#profile-edit").click());
  $("#detail-close").addEventListener("click", () => $("#detail-dialog").close());
  $("#detail-action").addEventListener("click", () => $("#detail-dialog").close());
  window.BookClubProfile.initialize({
    getContext: () => ({ user: state.user, data: state.data }),
    onSaved: (data) => {
      state.data = data;
      render();
    },
    showToast
  });
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      applyTheme(nextTheme, true);
    });
  });

  $("#menu-toggle").addEventListener("click", () => {
    const nav = $("#main-nav");
    const isOpen = nav.classList.toggle("is-open");
    $("#menu-toggle").setAttribute("aria-expanded", String(isOpen));
  });
  $("#main-nav").addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      $("#main-nav").classList.remove("is-open");
      $("#menu-toggle").setAttribute("aria-expanded", "false");
    }
  });
  $("#search-toggle").addEventListener("click", () => {
    $("#activity-search").focus();
    $("#atividades").scrollIntoView({ behavior: "smooth" });
  });
  $("#notification-toggle").addEventListener("click", () => showToast("Você está em dia com as novidades do clube. Boa leitura!"));

  async function init() {
    try {
      let storedTheme = "dark";
      try {
        storedTheme = localStorage.getItem("entrelinhas-theme-v1") || "dark";
      } catch (error) {
        showToast(`Não foi possível recuperar sua preferência de tema: ${error.message}`, true);
      }
      applyTheme(storedTheme, false);
      const today = new Date();
      const localToday = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      ["#admin-book-deadline", "#admin-task-deadline"].forEach((selector) => { $(selector).min = localToday; });
      await window.BookClubAuth.initialize({
        onAuthenticated: (user) => loadForUser(user),
        onSignedOut: clearSession,
        showToast
      });
    } catch (error) {
      $("#gate-error").textContent = error.message || "Não foi possível validar sua sessão.";
    }
  }
  init();
})();
