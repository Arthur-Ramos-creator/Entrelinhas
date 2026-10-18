(() => {
  const genres = ["Ficção", "Filosofia", "Romance", "Fantasia", "Biografia", "Mistério", "Poesia", "História", "Suspense", "Não ficção"];
  const dialog = document.querySelector("#profile-dialog");
  const form = document.querySelector("#profile-form");
  let getContext = () => null;
  let onSaved = () => {};
  let showToast = () => {};
  let avatarUpload = "";
  let coverUpload = "";
  let originalAvatar = "";
  let originalCover = "";

  function renderGenres(selected = []) {
    document.querySelector("#genre-options").innerHTML = genres.map((genre) => `
      <label class="genre-chip"><input type="checkbox" value="${genre}" ${selected.includes(genre) ? "checked" : ""}><span>${genre}</span></label>
    `).join("");
  }

  function open() {
    const context = getContext();
    if (!context?.data || !context?.user) return;
    const profile = context.data.profile;
    avatarUpload = "";
    coverUpload = "";
    originalAvatar = profile.avatar_url || "";
    originalCover = profile.cover_url || "";
    document.querySelector("#edit-display-name").value = profile.name || "";
    document.querySelector("#edit-username").value = profile.username || "";
    document.querySelector("#edit-avatar-url").value = profile.avatar_url?.startsWith("data:") ? "" : (profile.avatar_url || "");
    document.querySelector("#edit-cover-url").value = profile.cover_url?.startsWith("data:") ? "" : (profile.cover_url || "");
    document.querySelector("#edit-bio").value = profile.bio || "";
    document.querySelector("#edit-quote").value = profile.motivational_quote || "";
    const socials = profile.social_links || {};
    document.querySelector("#edit-instagram").value = socials.instagram || "";
    document.querySelector("#edit-goodreads").value = socials.goodreads || "";
    document.querySelector("#edit-skoob").value = socials.skoob || "";
    document.querySelector("#edit-twitter").value = socials.twitter || "";
    renderGenres(profile.favorite_genres || []);
    updateCoverPreview(profile.cover_url || "");
    document.querySelector("#profile-form-error").textContent = "";
    dialog.showModal();
  }

  function updateCoverPreview(url) {
    const preview = document.querySelector("#profile-cover-preview");
    const safeUrl = normalizeImageUrl(url);
    preview.style.backgroundImage = safeUrl
      ? `linear-gradient(90deg, rgba(0,0,0,.55), rgba(0,0,0,.12)), url("${escapeCssUrl(safeUrl)}")`
      : "";
    preview.classList.toggle("has-cover", Boolean(safeUrl));
  }

  function escapeCssUrl(value) {
    return value.replace(/[\\")\n\r]/g, (character) => `\\${character}`);
  }

  function normalizeImageUrl(value) {
    if (!value) return "";
    if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(value)) return value;
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
    } catch {
      return "";
    }
  }

  function normalizeSocialUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
      return url.href;
    } catch {
      throw new Error("Use links sociais válidos começando com https://.");
    }
  }

  function readImage(file) {
    if (!file) return Promise.resolve("");
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      return Promise.reject(new Error("Use uma imagem JPG, PNG, WebP ou GIF."));
    }
    if (file.size > 1200000) return Promise.reject(new Error("Cada imagem deve ter no máximo 1,2 MB."));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result)));
      reader.addEventListener("error", () => reject(new Error("Não foi possível abrir esta imagem.")));
      reader.readAsDataURL(file);
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const context = getContext();
    const submit = document.querySelector("#profile-save");
    submit.disabled = true;
    document.querySelector("#profile-form-error").textContent = "";
    try {
      const avatarInput = document.querySelector("#edit-avatar-url").value.trim();
      const coverInput = document.querySelector("#edit-cover-url").value.trim();
      const avatarUrl = avatarUpload || normalizeImageUrl(avatarInput) || originalAvatar;
      const coverUrl = coverUpload || normalizeImageUrl(coverInput) || originalCover;
      if ((avatarInput && !avatarUrl) || (coverInput && !coverUrl)) {
        throw new Error("Use uma URL de imagem válida com http:// ou https://.");
      }
      const favoriteGenres = Array.from(document.querySelectorAll("#genre-options input:checked"), (input) => input.value);
      const profile = {
        name: document.querySelector("#edit-display-name").value,
        username: document.querySelector("#edit-username").value,
        avatar_url: avatarUpload || avatarUrl,
        cover_url: coverUpload || coverUrl,
        bio: document.querySelector("#edit-bio").value,
        motivational_quote: document.querySelector("#edit-quote").value,
        social_links: {
          instagram: normalizeSocialUrl(document.querySelector("#edit-instagram").value.trim()),
          goodreads: normalizeSocialUrl(document.querySelector("#edit-goodreads").value.trim()),
          skoob: normalizeSocialUrl(document.querySelector("#edit-skoob").value.trim()),
          twitter: normalizeSocialUrl(document.querySelector("#edit-twitter").value.trim())
        },
        favorite_genres: favoriteGenres
      };
      const updatedData = await window.BookClubDB.saveProfile(context.user.id, context.data, profile);
      onSaved(updatedData);
      dialog.close();
      showToast("Seu perfil foi atualizado.");
    } catch (error) {
      document.querySelector("#profile-form-error").textContent = error.message || "Não foi possível salvar seu perfil.";
    } finally {
      submit.disabled = false;
    }
  }

  function initialize(options) {
    getContext = options.getContext;
    onSaved = options.onSaved;
    showToast = options.showToast;
    document.querySelector("#profile-edit").addEventListener("click", open);
    document.querySelector("#profile-close").addEventListener("click", () => dialog.close());
    form.addEventListener("submit", handleSubmit);
    document.querySelector("#edit-cover-url").addEventListener("input", (event) => updateCoverPreview(event.target.value));
    document.querySelector("#edit-cover-file").addEventListener("change", async (event) => {
      try {
        coverUpload = await readImage(event.target.files[0]);
        updateCoverPreview(coverUpload || document.querySelector("#edit-cover-url").value);
      } catch (error) {
        event.target.value = "";
        showToast(error.message, true);
      }
    });
    document.querySelector("#edit-avatar-file").addEventListener("change", async (event) => {
      try {
        avatarUpload = await readImage(event.target.files[0]);
      } catch (error) {
        event.target.value = "";
        showToast(error.message, true);
      }
    });
  }

  window.BookClubProfile = Object.freeze({ initialize });
})();
