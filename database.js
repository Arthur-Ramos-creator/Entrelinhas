/* Supabase browser client. Keep only the public anon/publishable key in frontend code. */
(() => {
  const config = window.CLUBE_SUPABASE_CONFIG || {};
  const isPlaceholder = (value) => !value || /YOUR_|YOUR-|PLACEHOLDER/i.test(value);
  const hasConfig = !isPlaceholder(config.url) && !isPlaceholder(config.anonKey);
  const projectUrl = hasConfig
    ? config.url.trim().replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "")
    : "";
  const supabaseClient = hasConfig && window.supabase?.createClient
    ? window.supabase.createClient(projectUrl, config.anonKey)
    : null;
  window.supabaseClient = supabaseClient;
  const LOCAL_KEY = "entrelinhas-demo-v1";
  const LOCAL_ADMIN_ID = "local-admin";
  const localKeyForData = (data) => data?.profile?.id === LOCAL_ADMIN_ID ? `${LOCAL_KEY}:admin` : LOCAL_KEY;

  const defaultData = () => ({
    profile: {
      id: "demo-user",
      name: "Marina Oliveira",
      username: "marina",
      email: "",
      avatar_url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=160&q=80",
      cover_url: "",
      bio: "",
      motivational_quote: "Disciplina hoje, liberdade amanhã.",
      social_links: {},
      favorite_genres: [],
      preferred_theme: "dark",
      level: 3,
      total_points: 1180,
      xp: 180,
      xp_target: 500,
      streak: 7,
      books_read: 12
    },
    activities: [],
    mission: { title: "", author: "", description: "", progress: 0, pages_read: 0, pages_total: 0, minutes_read: 0 },
    readingLogs: [],
    clubs: [],
    members: [],
    comments: [],
    currentBook: null
  });

  function readLocalData(key = LOCAL_KEY) {
    try {
      const saved = localStorage.getItem(key);
      if (!saved) {
        const initial = defaultData();
        localStorage.setItem(key, JSON.stringify(initial));
        return initial;
      }
      const parsed = JSON.parse(saved);
      const defaults = defaultData();
      return {
        ...defaults,
        ...parsed,
        version: 2,
        profile: { ...defaults.profile, ...parsed.profile },
        activities: parsed.version === 2 && Array.isArray(parsed.activities) ? parsed.activities : [],
        mission: { ...defaults.mission, ...parsed.mission },
        readingLogs: Array.isArray(parsed.readingLogs) ? parsed.readingLogs : [],
        clubs: Array.isArray(parsed.clubs) ? parsed.clubs.map((club) => {
          const isCreator = club.is_creator || club.creator_id === parsed.profile?.id;
          const role = isCreator ? "owner" : (club.role || "reader");
          return { ...club, role, is_creator: isCreator, is_admin: isCreator || role === "admin" };
        }) : []
      };
    } catch (error) {
      throw new Error(`Não foi possível ler os dados de demonstração: ${error.message}`);
    }
  }

  function saveLocalData(data, key = localKeyForData(data)) {
    try {
      localStorage.setItem(key, JSON.stringify({ ...data, version: 2 }));
    } catch (error) {
      throw new Error(`Não foi possível salvar o progresso neste navegador: ${error.message}`);
    }
  }

  function createLocalAdminUser() {
    return {
      id: LOCAL_ADMIN_ID,
      email: "admin@entrelinhas.local",
      user_metadata: { name: "Administrador de teste", username: "admin" },
      isLocalTestUser: true
    };
  }

  async function getSession() {
    if (!supabaseClient) return null;
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function loadUserData(user) {
    if (!supabaseClient || !user) {
      const data = readLocalData(user?.isLocalTestUser ? `${LOCAL_KEY}:admin` : LOCAL_KEY);
      if (user?.isLocalTestUser) {
        if (data.profile.id !== LOCAL_ADMIN_ID) data.profile = {
          ...data.profile,
          id: LOCAL_ADMIN_ID,
          name: "Administrador de teste",
          username: "admin",
          email: "admin@entrelinhas.local",
          avatar_url: "https://ui-avatars.com/api/?name=Admin&background=6f412e&color=fff",
          level: 1,
          total_points: 0,
          xp: 0,
          streak: 0,
          books_read: 0,
          preferred_theme: data.profile.preferred_theme || "dark"
        };
        saveLocalData(data);
      }
      const selectedClub = data.clubs.find((club) => club.id === data.selectedClubId) || data.clubs[0];
      if (!selectedClub) return data;
      return loadClubWorkspace(user?.id, data, selectedClub.id);
    }
    const { data: profile, error: profileError } = await supabaseClient
      .from("users").select("*").eq("id", user.id).maybeSingle();
    if (profileError) throw profileError;
    const fallback = defaultData();
    const email = typeof user.email === "string" ? user.email : "";
    const userProfile = profile || {
      id: user.id,
      name: user.user_metadata?.name || (email || "").split("@")[0] || "Leitor(a)",
      username: String(user.user_metadata?.username || (email || "").split("@")[0] || "leitor")
        .toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30) || "leitor",
      email,
      avatar_url: fallback.profile.avatar_url,
      cover_url: "",
      bio: "",
      motivational_quote: "Disciplina hoje, liberdade amanhã.",
      social_links: {},
      favorite_genres: [],
      preferred_theme: "dark",
      level: 1,
      total_points: 0,
      xp: 0,
      xp_target: 500,
      streak: 0,
      books_read: 0
    };
    if (!profile) {
      const { error } = await supabaseClient.rpc("ensure_club_profile", {
        p_name: userProfile.name,
        p_username: userProfile.username,
        p_email: user.email || "",
        p_avatar_url: userProfile.avatar_url
      });
      if (error) throw error;
      const { data, error: createdProfileError } = await supabaseClient
        .from("users").select("*").eq("id", user.id).single();
      if (createdProfileError) throw createdProfileError;
      Object.assign(userProfile, data);
    }
    const { data: memberships, error: membershipsError } = await supabaseClient
      .from("club_members").select("club_id, role").eq("user_id", user.id);
    if (membershipsError) throw membershipsError;
    const clubIds = (memberships || []).map((membership) => membership.club_id);
    let clubs = [];
    if (clubIds.length) {
      const { data, error } = await supabaseClient.from("book_clubs").select("*").in("id", clubIds).order("created_at", { ascending: false });
      if (error) throw error;
      clubs = (data || []).map((club) => {
        const membership = memberships.find((item) => item.club_id === club.id);
        const isCreator = club.creator_id === user.id;
        const role = isCreator ? "owner" : (membership?.role || "reader");
        return { ...club, role, is_creator: isCreator, is_admin: isCreator || role === "admin" };
      });
    }
    const selectedId = (() => {
      try { return localStorage.getItem(`entrelinhas-selected-club:${user.id}`); } catch { return null; }
    })();
    const selectedClub = clubs.find((club) => club.id === selectedId) || clubs[0] || null;
    const result = {
      profile: userProfile,
      activities: [],
      mission: fallback.mission,
      readingLogs: [],
      clubs,
      members: [],
      comments: [],
      currentBook: null,
      selectedClubId: selectedClub?.id || null
    };
    return selectedClub ? loadClubWorkspace(user.id, result, selectedClub.id) : result;
  }

  async function loadClubWorkspace(userId, data, clubId) {
    const club = (data.clubs || []).find((item) => item.id === clubId);
    if (!club) throw new Error("Este clube não está disponível para sua conta.");
    if (!supabaseClient) {
      const localClub = { ...club };
      const book = localClub.current_book || null;
      return {
        ...data,
        selectedClubId: club.id,
        currentBook: book,
        mission: book ? {
          ...book,
          ...(localClub.progress || {}),
          pages_total: book.pages_total || 0,
          progress: book.pages_total ? Math.min(100, Math.round(((localClub.progress?.pages_read || 0) / book.pages_total) * 100)) : 0
        } : defaultData().mission,
        activities: Array.isArray(localClub.activities) ? localClub.activities : [],
        readingLogs: localClub.readingLogs || [],
        comments: localClub.comments || [],
        members: data.members?.length ? data.members : [{ user_id: userId || "demo-user", name: data.profile.name, username: data.profile.username, avatar_url: data.profile.avatar_url, role: club.role || "owner" }]
      };
    }

    const [{ data: book, error: bookError }, { data: members, error: membersError }] = await Promise.all([
      supabaseClient.from("club_books").select("*").eq("club_id", clubId).eq("is_current", true).maybeSingle(),
      supabaseClient.rpc("get_club_members", { p_club_id: clubId })
    ]);
    if (bookError) throw bookError;
    if (membersError) throw membersError;

    let progress = null;
    let readingLogs = [];
    let comments = [];
    if (book) {
      const [{ data: savedProgress, error: progressError }, { data: logs, error: logsError }, { data: bookComments, error: commentsError }] = await Promise.all([
        supabaseClient.from("club_reading_progress").select("*").eq("book_id", book.id).eq("user_id", userId).maybeSingle(),
        supabaseClient.from("club_reading_logs").select("*").eq("book_id", book.id).eq("user_id", userId).order("logged_at", { ascending: false }).limit(8),
        supabaseClient.rpc("get_club_comments", { p_book_id: book.id })
      ]);
      if (progressError) throw progressError;
      if (logsError) throw logsError;
      if (commentsError) throw commentsError;
      progress = savedProgress;
      readingLogs = logs || [];
      comments = bookComments || [];
    }

    const [{ data: tasks, error: tasksError }, { data: completions, error: completionsError }] = await Promise.all([
      supabaseClient.from("club_tasks").select("*").eq("club_id", clubId).order("created_at", { ascending: false }),
      supabaseClient.from("club_task_completions").select("task_id").eq("user_id", userId)
    ]);
    if (tasksError) throw tasksError;
    if (completionsError) throw completionsError;
    const completedIds = new Set((completions || []).map((item) => item.task_id));
    const currentBook = book ? { ...book } : null;
    const mission = currentBook ? {
      ...currentBook,
      pages_read: progress?.pages_read || 0,
      pages_total: currentBook.pages_total || 0,
      minutes_read: progress?.minutes_read || 0,
      progress: currentBook.pages_total ? Math.min(100, Math.round(((progress?.pages_read || 0) / currentBook.pages_total) * 100)) : 0
    } : defaultData().mission;
    return {
      ...data,
      selectedClubId: clubId,
      currentBook,
      mission,
      readingLogs,
      comments,
      members: members || [],
      activities: (tasks || []).map((task) => ({
        ...task,
        completed: completedIds.has(task.id),
        progress: completedIds.has(task.id) ? 100 : 0
      }))
    };
  }

  async function selectClub(userId, data, clubId) {
    if (!(data.clubs || []).some((club) => club.id === clubId)) throw new Error("Selecione um clube da sua lista.");
    if (supabaseClient) {
      try { localStorage.setItem(`entrelinhas-selected-club:${userId}`, clubId); } catch (error) { throw new Error(`Não foi possível salvar o clube selecionado: ${error.message}`); }
    } else {
      saveLocalData({ ...data, selectedClubId: clubId });
    }
    return loadClubWorkspace(userId, data, clubId);
  }

  async function completeActivity(userId, data, activityId, pointsGiven) {
    const activity = data.activities.find((item) => item.id === activityId);
    if (!activity) throw new Error("Esta atividade não foi encontrada.");
    if (activity.completed) return data;
    if (pointsGiven !== undefined && Number(pointsGiven) !== Number(activity.points)) {
      throw new Error("A pontuação informada não corresponde à atividade.");
    }
    const updatedActivity = { ...activity, completed: true, progress: 100 };
    const xpTarget = Number(data.profile.xp_target) || 500;
    let nextXp = (Number(data.profile.xp) || 0) + Number(activity.points);
    let nextLevel = Number(data.profile.level) || 1;
    let nextTarget = xpTarget;
    while (nextXp >= nextTarget) {
      nextXp -= nextTarget;
      nextLevel += 1;
    }
    const updatedProfile = {
      ...data.profile,
      total_points: (Number(data.profile.total_points) || 0) + Number(activity.points),
      xp: nextXp,
      xp_target: nextTarget,
      level: nextLevel
    };
    if (!supabaseClient) {
      const updatedData = {
        ...data,
        profile: updatedProfile,
        activities: data.activities.map((item) => item.id === activityId ? updatedActivity : item),
        clubs: data.clubs.map((club) => ({
          ...club,
          activities: (club.activities || []).map((item) => item.id === activityId ? updatedActivity : item)
        })),
        lastPointsAwarded: Number(activity.points)
      };
      saveLocalData(updatedData);
      return updatedData;
    }

    const { data: savedProfile, error } = await supabaseClient.rpc("complete_club_task", {
      p_task_id: activityId
    });
    if (error) throw error;
    if (!savedProfile?.length) throw new Error("A atividade já foi concluída em outra sessão. Atualize seus dados.");
    return {
      ...data,
      profile: { ...data.profile, ...savedProfile[0] },
      activities: data.activities.map((item) => item.id === activityId ? updatedActivity : item),
      lastPointsAwarded: Number(activity.points)
    };
  }

  async function logReading(userId, data, entry) {
    const pages = entry.mode === "pages" ? Number(entry.pages) : 0;
    const minutes = entry.mode === "time" ? Number(entry.minutes) : 0;
    if (!Number.isInteger(pages) || pages < 0 || pages > 10000 || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
      throw new Error("Informe páginas ou tempo válidos para registrar a leitura.");
    }
    if ((entry.mode === "pages" && pages < 1) || (entry.mode === "time" && minutes < 1)) {
      throw new Error("Registre pelo menos uma página ou um minuto de leitura.");
    }
    if (!data.currentBook || !data.selectedClubId) throw new Error("Seu clube ainda não adicionou um livro para registrar a leitura.");
    if (supabaseClient) {
      const { data: result, error } = await supabaseClient.rpc("log_club_book_reading", {
        p_book_id: data.currentBook.id,
        p_mode: entry.mode,
        p_pages: pages,
        p_minutes: minutes
      });
      if (error) throw error;
      if (!result?.length) throw new Error("Não foi possível registrar sua leitura.");
      const saved = result[0];
      const log = { mode: entry.mode, pages, minutes, logged_at: new Date().toISOString() };
      return {
        ...data,
        mission: {
          ...data.mission,
          pages_read: saved.pages_read,
          pages_total: saved.pages_total,
          minutes_read: saved.minutes_read,
          progress: saved.pages_total ? Math.min(100, Math.round((saved.pages_read / saved.pages_total) * 100)) : 0
        },
        readingLogs: [log, ...(data.readingLogs || [])].slice(0, 8)
      };
    }
    const log = {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
      mode: entry.mode,
      pages,
      minutes,
      logged_at: new Date().toISOString()
    };
    const updated = {
      ...data,
      mission: {
        ...data.mission,
        pages_read: (Number(data.mission.pages_read) || 0) + pages,
        minutes_read: (Number(data.mission.minutes_read) || 0) + minutes,
        progress: data.mission.pages_total
          ? Math.min(100, Math.round((((Number(data.mission.pages_read) || 0) + pages) / Number(data.mission.pages_total)) * 100))
          : 0
      },
      readingLogs: [log, ...(data.readingLogs || [])].slice(0, 8)
    };
    updated.clubs = data.clubs.map((club) => club.id === data.selectedClubId
      ? {
          ...club,
          progress: updated.mission,
          readingLogs: updated.readingLogs
        }
      : club);
    saveLocalData(updated);
    return updated;
  }

  function makeInviteCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  }

  async function createClub(userId, details, data) {
    const clubName = details.name.trim();
    if (!clubName) throw new Error("Informe um nome para o clube.");
    if (supabaseClient) {
      if (!userId) throw new Error("Entre na sua conta para criar um clube que possa ser compartilhado.");
      const { data: created, error } = await supabaseClient.rpc("create_reading_club", { p_name: clubName });
      if (error) throw error;
      const club = { ...(Array.isArray(created) ? created[0] : created), role: "owner", is_creator: true, is_admin: true };
      try { localStorage.setItem(`entrelinhas-selected-club:${userId}`, club.id); } catch (error) { throw new Error(`Não foi possível selecionar o clube: ${error.message}`); }
      return loadClubWorkspace(userId, { ...data, clubs: [club, ...(data.clubs || [])], selectedClubId: club.id }, club.id);
    }
    const club = {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
      code: makeInviteCode(),
      name: clubName,
      creator_id: userId || "demo-user",
      is_creator: true,
      is_admin: true,
      role: "owner",
      book_title: "",
      book_author: "",
      week_ends: "",
      created_at: new Date().toISOString()
    };
    const updated = {
      ...data,
      clubs: [club, ...(data.clubs || [])],
      selectedClubId: club.id,
      currentBook: null,
      mission: defaultData().mission,
      activities: [],
      readingLogs: [],
      comments: [],
      members: []
    };
    saveLocalData(updated);
    return loadClubWorkspace(userId, updated, club.id);
  }

  async function joinClub(userId, code, data) {
    const inviteCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(inviteCode)) throw new Error("O código do clube deve ter 8 letras ou números.");
    if (supabaseClient) {
      if (!userId) throw new Error("Entre na sua conta para participar de um clube.");
      const { data: joined, error } = await supabaseClient.rpc("join_reading_club", { p_code: inviteCode });
      if (error) throw error;
      if (!joined) throw new Error("Não encontramos um clube com esse código.");
      const club = { ...joined, role: joined.creator_id === userId ? "owner" : "reader", is_creator: joined.creator_id === userId, is_admin: joined.creator_id === userId };
      try { localStorage.setItem(`entrelinhas-selected-club:${userId}`, club.id); } catch (error) { throw new Error(`Você entrou no clube, mas a seleção não pôde ser salva: ${error.message}`); }
      return loadClubWorkspace(userId, { ...data, clubs: [club, ...(data.clubs || []).filter((item) => item.id !== club.id)], selectedClubId: club.id }, club.id);
    }
    const club = (data.clubs || []).find((item) => item.code.toUpperCase() === inviteCode);
    if (!club) throw new Error("Este código não existe neste navegador. No modo demonstração, os clubes não são compartilhados entre dispositivos.");
    return data;
  }

  async function addWeeklyBook(userId, data, details) {
    const club = data.clubs.find((item) => item.id === data.selectedClubId);
    if (!club?.is_admin) throw new Error("Somente os administradores do clube podem adicionar livros.");
    const title = String(details.title || "").trim();
    const author = String(details.author || "").trim();
    const pages = Number(details.pages);
    if (!title || !author || !details.weekEnds || !Number.isInteger(pages) || pages < 1 || pages > 10000) {
      throw new Error("Preencha título, autor, prazo e um total de páginas válido.");
    }
    if (supabaseClient) {
      const { error } = await supabaseClient.rpc("set_club_weekly_book", {
        p_club_id: club.id,
        p_title: title,
        p_author: author,
        p_description: String(details.description || "").trim(),
        p_pages_total: pages,
        p_week_ends: details.weekEnds
      });
      if (error) throw error;
      return loadClubWorkspace(userId, data, club.id);
    }
    const currentBook = {
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
      title, author, description: String(details.description || "").trim(),
      pages_total: pages, week_ends: details.weekEnds, is_current: true
    };
    const updatedClub = { ...club, current_book: currentBook, progress: { pages_read: 0, minutes_read: 0 }, readingLogs: [], comments: [] };
    const updated = { ...data, clubs: data.clubs.map((item) => item.id === club.id ? updatedClub : item) };
    saveLocalData(updated);
    return loadClubWorkspace(userId, updated, club.id);
  }

  async function createClubTask(userId, data, details) {
    const club = data.clubs.find((item) => item.id === data.selectedClubId);
    if (!club?.is_admin) throw new Error("Somente os administradores do clube podem criar atividades.");
    const title = String(details.title || "").trim();
    const description = String(details.description || "").trim();
    const points = Number(details.points);
    if (!title || !description || !details.dueDate || !Number.isInteger(points) || points < 0 || points > 1000) {
      throw new Error("Preencha título, descrição, prazo e uma recompensa válida.");
    }
    if (supabaseClient) {
      const { error } = await supabaseClient.rpc("create_club_task", {
        p_club_id: club.id,
        p_title: title,
        p_description: description,
        p_points: points,
        p_due_date: details.dueDate,
        p_category: String(details.category || "LEITURA").trim()
      });
      if (error) throw error;
      return loadClubWorkspace(userId, data, club.id);
    }
    const task = { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}`, title, description, points, due_date: details.dueDate, category: details.category || "LEITURA", completed: false, progress: 0 };
    const updated = { ...data, clubs: data.clubs.map((item) => item.id === club.id ? { ...item, activities: [task, ...(item.activities || [])] } : item) };
    saveLocalData(updated);
    return loadClubWorkspace(userId, updated, club.id);
  }

  async function addBookComment(userId, data, body) {
    const club = data.clubs.find((item) => item.id === data.selectedClubId);
    const text = String(body || "").trim();
    if (!club || !data.currentBook) throw new Error("O clube ainda não escolheu um livro para comentar.");
    if (!text || text.length > 1000) throw new Error("O comentário deve ter entre 1 e 1000 caracteres.");
    if (supabaseClient) {
      const { error } = await supabaseClient.rpc("add_club_comment", { p_book_id: data.currentBook.id, p_body: text });
      if (error) throw error;
      return loadClubWorkspace(userId, data, club.id);
    }
    const comment = {
      comment_id: globalThis.crypto?.randomUUID?.() || `${Date.now()}`,
      user_id: userId || "demo-user",
      name: data.profile.name,
      username: data.profile.username,
      avatar_url: data.profile.avatar_url,
      body: text,
      created_at: new Date().toISOString()
    };
    const updated = { ...data, clubs: data.clubs.map((item) => item.id === club.id ? { ...item, comments: [comment, ...(item.comments || [])] } : item) };
    saveLocalData(updated);
    return loadClubWorkspace(userId, updated, club.id);
  }

  async function promoteClubMember(userId, data, memberId) {
    const club = data.clubs.find((item) => item.id === data.selectedClubId);
    if (!club || club.role !== "owner") throw new Error("Somente quem criou o clube pode promover outro administrador.");
    if (supabaseClient) {
      const { error } = await supabaseClient.rpc("promote_club_admin", { p_club_id: club.id, p_member_id: memberId });
      if (error) throw error;
      return loadClubWorkspace(userId, data, club.id);
    }
    const updated = {
      ...data,
      members: data.members.map((member) => member.user_id === memberId ? { ...member, role: "admin" } : member)
    };
    saveLocalData(updated);
    return updated;
  }

  async function deleteClub(userId, data, clubId) {
    const club = data.clubs.find((item) => item.id === clubId);
    if (!club) throw new Error("Este clube não foi encontrado.");
    const isCreator = club.is_creator || club.creator_id === userId;
    if (!isCreator || (supabaseClient && club.creator_id !== userId)) {
      throw new Error("Somente a pessoa que criou o clube pode excluí-lo.");
    }
    if (supabaseClient) {
      const { error } = await supabaseClient.rpc("delete_reading_club", { p_club_id: clubId });
      if (error) throw error;
    }

    const clubs = data.clubs.filter((item) => item.id !== clubId);
    const deletedSelectedClub = data.selectedClubId === clubId;
    if (supabaseClient) {
      try {
        if (deletedSelectedClub && clubs.length) localStorage.setItem(`entrelinhas-selected-club:${userId}`, clubs[0].id);
        else if (deletedSelectedClub) localStorage.removeItem(`entrelinhas-selected-club:${userId}`);
      } catch (error) {
        throw new Error(`O clube foi excluído, mas não foi possível atualizar a seleção local: ${error.message}`);
      }
    }
    const updated = {
      ...data,
      clubs,
      selectedClubId: deletedSelectedClub ? (clubs[0]?.id || null) : data.selectedClubId,
      ...(deletedSelectedClub ? {
        currentBook: null,
        mission: defaultData().mission,
        activities: [],
        readingLogs: [],
        comments: [],
        members: []
      } : {})
    };
    saveLocalData(updated);
    return deletedSelectedClub && clubs.length
      ? loadClubWorkspace(userId, updated, clubs[0].id)
      : updated;
  }

  async function saveProfile(userId, data, profile) {
    const normalized = {
      name: profile.name.trim(),
      username: profile.username.trim().replace(/^@/, "").toLowerCase(),
      avatar_url: profile.avatar_url || "",
      cover_url: profile.cover_url || "",
      bio: profile.bio.trim(),
      motivational_quote: profile.motivational_quote.trim(),
      social_links: profile.social_links,
      favorite_genres: profile.favorite_genres
    };
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(normalized.username)) {
      throw new Error("O nome de usuário deve ter de 3 a 30 letras, números ou sublinhados.");
    }
    if (supabaseClient) {
      const { data: savedProfile, error } = await supabaseClient.rpc("save_club_profile", {
        p_name: normalized.name,
        p_username: normalized.username,
        p_avatar_url: normalized.avatar_url,
        p_cover_url: normalized.cover_url,
        p_bio: normalized.bio,
        p_motivational_quote: normalized.motivational_quote,
        p_social_links: normalized.social_links,
        p_favorite_genres: normalized.favorite_genres
      });
      if (error) {
        if (error.code === "23505") throw new Error("Este nome de usuário já está em uso.");
        throw error;
      }
      return { ...data, profile: { ...data.profile, ...(Array.isArray(savedProfile) ? savedProfile[0] : savedProfile) } };
    }
    const updated = { ...data, profile: { ...data.profile, ...normalized } };
    saveLocalData(updated);
    return updated;
  }

  async function saveTheme(userId, data, theme) {
    if (!["dark", "light"].includes(theme)) throw new Error("Tema inválido.");
    if (supabaseClient) {
      if (!userId) throw new Error("Entre na sua conta para salvar sua preferência de tema.");
      const { error } = await supabaseClient.rpc("save_club_theme", { p_theme: theme });
      if (error) throw error;
    } else {
      saveLocalData({ ...data, profile: { ...data.profile, preferred_theme: theme } });
    }
    return { ...data, profile: { ...data.profile, preferred_theme: theme } };
  }

  async function signIn(email, password) {
    if (!supabaseClient) throw new Error("O login estará disponível quando a integração Supabase estiver configurada.");
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  }

  async function signInWithUsername(username, password) {
    if (!supabaseClient) throw new Error("O login estará disponível quando a integração Supabase estiver configurada.");
    const { data, error } = await supabaseClient.functions.invoke("sign-in-username", {
      body: { username: username.replace(/^@/, "").trim().toLowerCase(), password }
    });
    if (error) throw new Error("Usuário ou senha inválidos. Confira seus dados e tente novamente.");
    if (!data?.session) throw new Error("Não foi possível iniciar a sessão com esse nome de usuário.");
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.setSession(data.session);
    if (sessionError) throw sessionError;
    return sessionData.user;
  }

  async function signUp(name, username, email, password) {
    if (!supabaseClient) throw new Error("O cadastro estará disponível quando a integração Supabase estiver configurada.");
    const { data, error } = await supabaseClient.auth.signUp({
      email, password, options: { data: { name, username } }
    });
    if (error) throw error;
    if (data.user && !data.session) {
      return { user: data.user, confirmationRequired: true };
    }
    return { user: data.user, confirmationRequired: false };
  }

  async function signOut() {
    if (!supabaseClient) return;
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
  }

  function clearSessionData() {
    try {
      localStorage.removeItem("entrelinhas-local-admin-session-v1");
      localStorage.removeItem("entrelinhas-theme-v1");
      localStorage.removeItem("entrelinhas-pending-invite-v1");
    } catch (error) {
      throw new Error(`Não foi possível limpar os dados locais da sessão: ${error.message}`);
    }
  }

  window.BookClubDB = Object.freeze({
    client: supabaseClient,
    isConfigured: Boolean(supabaseClient),
    mode: supabaseClient ? "supabase" : "demo",
    getSession,
    loadUserData,
    loadClubWorkspace,
    selectClub,
    completeActivity,
    logReading,
    createClub,
    joinClub,
    addWeeklyBook,
    createClubTask,
    addBookComment,
    promoteClubMember,
    deleteClub,
    saveProfile,
    saveTheme,
    signIn,
    signInWithUsername,
    signUp,
    signOut,
    createLocalAdminUser,
    clearSessionData
  });
})();
