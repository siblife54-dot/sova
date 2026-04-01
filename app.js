(function () {
  "use strict";

  var PROGRESS_STORAGE_KEY = "course_branch_progress_v1";
  var BRANCH_ORDER = ["fear", "resentment", "guilt", "aggression"];
  var BRANCH_COLORS = {
    fear: "#36c66b",
    resentment: "#3a7dff",
    guilt: "#ffd447",
    aggression: "#ff4f5f"
  };
  var BRANCH_TITLES = {
    fear: "Страх",
    resentment: "Обида",
    guilt: "Вина",
    aggression: "Агрессия"
  };

  function getConfig() {
    return window.APP_CONFIG || {};
  }

  function applyTheme(config) {
    var root = document.documentElement;
    root.style.setProperty("--accent", config.accentColor || "#8B5CF6");
    root.style.setProperty("--bg", config.backgroundColor || "#0E1B2B");
    root.style.setProperty("--card", config.cardColor || "#12243a");

    var brand = document.getElementById("brandName");
    if (brand) brand.textContent = config.brandName || "Кабинет курса";
  }

  function initTelegramViewport() {
    var tg = globalThis.Telegram && globalThis.Telegram.WebApp;
    if (!tg) return;

    if (typeof tg.ready === "function") tg.ready();
    if (typeof tg.expand === "function") tg.expand();
  }

  function loadProgress() {
    try {
      var raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
      if (!raw) {
        return { completedModules: {}, completedBranches: {} };
      }

      var parsed = JSON.parse(raw);
      return {
        completedModules: parsed && parsed.completedModules ? parsed.completedModules : {},
        completedBranches: parsed && parsed.completedBranches ? parsed.completedBranches : {}
      };
    } catch (e) {
      return { completedModules: {}, completedBranches: {} };
    }
  }

  function saveProgress(progress) {
    var safe = {
      completedModules: progress && progress.completedModules ? progress.completedModules : {},
      completedBranches: progress && progress.completedBranches ? progress.completedBranches : {}
    };

    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(safe));
  }

  function getModuleProgressKey(branchId, moduleId) {
    return branchId + "_" + moduleId;
  }

  function isBranchCompleted(branchId, modules, progress) {
    if (!modules || !modules.length) return false;

    return modules.every(function (module) {
      var key = getModuleProgressKey(branchId, module.module_id);
      return Boolean(progress.completedModules[key]);
    });
  }

  function isBranchUnlocked(branchId, progress) {
    if (branchId === "fear") return true;

    var index = BRANCH_ORDER.indexOf(branchId);
    if (index <= 0) return false;

    var previousBranchId = BRANCH_ORDER[index - 1];
    return Boolean(progress.completedBranches[previousBranchId]);
  }

  function isModuleUnlocked(branchId, moduleId, modules, progress) {
    if (!modules || !modules.length) return false;

    if (!isBranchUnlocked(branchId, progress)) return false;

    var index = modules.findIndex(function (module) {
      return module.module_id === moduleId;
    });

    if (index < 0) return false;
    if (index === 0) return true;

    var previousModule = modules[index - 1];
    var previousKey = getModuleProgressKey(branchId, previousModule.module_id);
    return Boolean(progress.completedModules[previousKey]);
  }

  function normalizeModule(raw) {
    return {
      course_id: raw.course_id,
      hero_image_url: raw.hero_image_url || "",
      hero_title: raw.hero_title || "",
      hero_text: raw.hero_text || "",
      hero_description: raw.hero_description || "",
      branch_id: (raw.branch_id || "").trim(),
      branch_title: raw.branch_title || "",
      branch_order: Number(raw.branch_order || 0),
      branch_image_url: raw.branch_image_url || "",
      branch_subtitle: raw.branch_subtitle || "",
      module_id: String(raw.module_id || raw.lesson_id || "").trim(),
      module_order: Number(raw.module_order || raw.day_number || 0),
      title: raw.title || "Без названия",
      subtitle: raw.subtitle || "",
      preview_image_url: raw.preview_image_url || raw.preview_image_ || "",
      video_url: raw.video_url || "",
      content_html: raw.content_html || "",
      content_text: raw.content_text || "",
      attachments: raw.attachments || "",
      is_locked: String(raw.is_locked || "0")
    };
  }

  async function fetchModules(config) {
    var url = config.useSampleData ? (config.sampleCsvPath || "./sample-sheet.csv") : config.googleSheetCsvUrl;
    if (!url) throw new Error("Не указан CSV URL. Проверьте config.js");

    var response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Ошибка загрузки данных. Проверьте CSV URL и публичный доступ.");
    }

    var text = await response.text();
    var rows = window.CSVUtils.parseCSV(text);

    return rows
      .map(normalizeModule)
      .filter(function (module) {
        return module.course_id === config.courseId;
      })
      .filter(function (module) {
        return Boolean(module.branch_id) && Boolean(module.module_id);
      });
  }

  function groupByBranches(modules) {
    var map = {};

    modules.forEach(function (module) {
      var branchId = module.branch_id;
      if (!map[branchId]) {
        map[branchId] = {
          meta: {
            branch_id: branchId,
            branch_title: module.branch_title || branchId,
            branch_order: Number(module.branch_order || 0),
            branch_image_url: module.branch_image_url || "",
            branch_subtitle: module.branch_subtitle || ""
          },
          modules: []
        };
      }
      map[branchId].modules.push(module);
    });

    Object.keys(map).forEach(function (branchId) {
      map[branchId].modules.sort(function (a, b) {
        return a.module_order - b.module_order;
      });
    });

    return map;
  }

  function getBranchThemeColor(branchId) {
    return BRANCH_COLORS[branchId] || "#8B5CF6";
  }

  function normalizePreviewImageUrl(url) {
    var value = String(url || "").trim();
    if (!value) return "";

    var byFilePath = value.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
    if (byFilePath && byFilePath[1]) {
      return "https://drive.google.com/thumbnail?id=" + byFilePath[1] + "&sz=w1200";
    }

    try {
      var parsed = new URL(value);
      var id = parsed.searchParams.get("id");
      if (/drive\.google\.com/i.test(parsed.host) && id) {
        return "https://drive.google.com/thumbnail?id=" + id + "&sz=w1200";
      }
    } catch (e) {
      return value;
    }

    return value;
  }

  function getBranchCardsData(branches, progress) {
    return BRANCH_ORDER.map(function (branchId) {
      var branch = branches[branchId] || null;
      var modules = branch ? branch.modules : [];
      var completed = branch ? isBranchCompleted(branchId, modules, progress) : false;
      var unlocked = isBranchUnlocked(branchId, progress);

      if (completed) {
        progress.completedBranches[branchId] = true;
      }

      return {
        branch_id: branchId,
        branch_title: branch ? (String(branch.meta.branch_title || "").trim() || branchId) : branchId,
        branch_subtitle: branch ? branch.meta.branch_subtitle : "",
        branch_image_url: branch ? normalizePreviewImageUrl(branch.meta.branch_image_url) : "",
        modules: modules,
        status: completed ? "completed" : (unlocked ? "unlocked" : "locked")
      };
    });
  }

  function getTelegramUser() {
    var tg = globalThis.Telegram && globalThis.Telegram.WebApp;
    if (!tg || !tg.initDataUnsafe || !tg.initDataUnsafe.user) return null;
    return tg.initDataUnsafe.user;
  }

  function getUserInitials(firstName, lastName) {
    var first = String(firstName || "").trim();
    var last = String(lastName || "").trim();
    var initials = (first.charAt(0) || "") + (last.charAt(0) || "");
    return initials.toUpperCase() || "U";
  }

  function renderUserCard() {
    var container = document.getElementById("userCard");
    if (!container) return;

    var user = getTelegramUser() || {};
    var firstName = String(user.first_name || "").trim();
    var lastName = String(user.last_name || "").trim();
    var fullName = [firstName, lastName].filter(Boolean).join(" ") || "Пользователь";
    var initials = getUserInitials(firstName, lastName);
    var photoUrl = String(user.photo_url || "").trim();

    container.innerHTML = [
      '<div class="user-avatar-wrap">',
      (photoUrl
        ? '<img class="user-avatar-img" src="' + escapeAttr(photoUrl) + '" alt="' + escapeAttr(fullName) + '" loading="lazy">'
        : '<div class="user-avatar-fallback">' + escapeHtml(initials) + '</div>'),
      '</div>',
      '<div class="user-meta">',
      '<h1>' + escapeHtml(fullName) + '</h1>',
      '<p>Доступ к программе открыт</p>',
      '</div>'
    ].join("");
  }

  function getCourseHero(modules, config) {
    if (!modules || !modules.length) {
      return {
        imageUrl: "",
        pretitle: "",
        title: String(config.brandName || "Кабинет курса").trim(),
        description: ""
      };
    }

    var source = modules.find(function (module) {
      return module.hero_image_url || module.hero_title || module.hero_text || module.hero_description;
    }) || modules[0];

    return {
      imageUrl: normalizePreviewImageUrl(source.hero_image_url || ""),
      pretitle: String(source.hero_title || "").trim(),
      title: String(source.hero_text || config.brandName || "Кабинет курса").trim(),
      description: String(source.hero_description || "").trim()
    };
  }

  function renderDashboardHero(modules, config) {
    var container = document.getElementById("dashboardHero");
    if (!container) return;

    var hero = getCourseHero(modules, config);
    var title = hero.title || String(config.brandName || "Кабинет курса").trim();

    container.classList.toggle("with-image", Boolean(hero.imageUrl));
    container.innerHTML = [
      '<div class="dashboard-hero-media">',
      (hero.imageUrl ? '<img src="' + escapeAttr(hero.imageUrl) + '" alt="' + escapeAttr(title) + '" loading="lazy">' : ""),
      '<div class="dashboard-hero-overlay"></div>',
      '<div class="dashboard-hero-content">',
      (hero.pretitle ? '<p class="dashboard-hero-pretitle">' + escapeHtml(hero.pretitle) + '</p>' : ""),
      '<h1>' + escapeHtml(title) + '</h1>',
      (hero.description ? '<div class="dashboard-hero-description hero-description">' + hero.description + '</div>' : ""),
      '</div>',
      '</div>'
    ].join("");
  }

  function renderDashboardProgress(cards) {
    var container = document.getElementById("dashboardProgress");
    if (!container) return;

    var total = BRANCH_ORDER.length;
    var done = cards.filter(function (card) {
      return card.status === "completed";
    }).length;
    var pct = total ? Math.round((done / total) * 100) : 0;

    container.innerHTML = [
      '<div class="dashboard-progress-head">',
      '<h2>Ваш прогресс</h2>',
      '<span class="dashboard-progress-pct">' + pct + '%</span>',
      '</div>',
      '<p>Пройдено: ' + done + ' из ' + total + '</p>',
      '<div class="dashboard-progress-bar"><div class="dashboard-progress-fill" style="width:' + pct + '%"></div></div>'
    ].join("");
  }

  function renderDashboard(modules, branches, progress, config) {
    var container = document.getElementById("branchesContainer");
    var stateBox = document.getElementById("stateBox");
    var cards = getBranchCardsData(branches, progress);
    renderDashboardHero(modules, config);
    renderUserCard();
    renderDashboardProgress(cards);

    if (!cards.some(function (card) { return card.modules.length; })) {
      container.innerHTML = "";
      stateBox.hidden = false;
      stateBox.classList.remove("skeleton");
      stateBox.textContent = "Нет модулей для отображения.";
      return;
    }

    stateBox.hidden = true;
    container.innerHTML = cards.map(function (card) {
      var color = getBranchThemeColor(card.branch_id);
      var locked = card.status === "locked";
      var completed = card.status === "completed";
      var href = "./branch.html?branch_id=" + encodeURIComponent(card.branch_id);

      return [
        '<article class="branch-card ' + (locked ? "locked" : "") + '" style="--branch-color:' + escapeAttr(color) + ';">',
        '<a class="branch-card-link"' + (locked ? "" : ' href="' + href + '"') + '>',
        '<div class="branch-card-image">',
        (card.branch_image_url ? '<img src="' + escapeAttr(card.branch_image_url) + '" alt="' + escapeAttr(card.branch_title) + '" loading="lazy">' : ""),
        '</div>',
        '<div class="branch-card-body">',
        '<h3>' + escapeHtml(String(card.branch_title || "").trim() || BRANCH_TITLES[card.branch_id] || card.branch_id) + '</h3>',
        '<p>' + escapeHtml(card.branch_subtitle || "") + '</p>',
        '<div class="branch-card-status">',
        (completed ? '<span class="status done">Пройдено ✓</span>' : ""),
        (!completed && locked ? '<span class="status locked">🔒 Закрыта</span>' : ""),
        (!completed && !locked ? '<span class="status open">Доступна</span>' : ""),
        '</div>',
        '</div>',
        '</a>',
        '</article>'
      ].join("");
    }).join("");
  }

  function renderBranchPage(branchId, branches, progress) {
    var stateBox = document.getElementById("branchState");
    var main = document.getElementById("branchMain");
    var hero = document.getElementById("branchHero");
    var modulesContainer = document.getElementById("modulesContainer");

    if (!branchId || !branches[branchId]) {
      stateBox.classList.remove("skeleton");
      stateBox.textContent = "Эмоция не найдена.";
      return;
    }

    if (!isBranchUnlocked(branchId, progress)) {
      stateBox.classList.remove("skeleton");
      stateBox.textContent = "Эта эмоция пока закрыта.";
      return;
    }

    var branch = branches[branchId];
    var modules = branch.modules;
    var color = getBranchThemeColor(branchId);

    stateBox.hidden = true;
    main.hidden = false;

    hero.style.setProperty("--branch-color", color);
    hero.innerHTML = [
      '<div class="branch-hero-image">',
      (branch.meta.branch_image_url ? '<img src="' + escapeAttr(normalizePreviewImageUrl(branch.meta.branch_image_url)) + '" alt="' + escapeAttr(branch.meta.branch_title) + '">' : ""),
      '</div>',
      '<div class="branch-hero-body">',
      '<h1>' + escapeHtml(branch.meta.branch_title) + '</h1>',
      '<p>' + escapeHtml(branch.meta.branch_subtitle || "") + '</p>',
      '</div>'
    ].join("");

    var completedCount = modules.filter(function (module) {
      var key = getModuleProgressKey(branchId, module.module_id);
      return Boolean(progress.completedModules[key]);
    }).length;

    var pct = modules.length ? Math.round((completedCount / modules.length) * 100) : 0;
    document.getElementById("branchProgressText").textContent = "Пройдено: " + completedCount + " из " + modules.length;
    document.getElementById("branchProgressPct").textContent = pct + "%";
    var fill = document.getElementById("branchProgressFill");
    fill.style.width = pct + "%";
    fill.style.background = color;

    modulesContainer.innerHTML = modules.map(function (module) {
      var key = getModuleProgressKey(branchId, module.module_id);
      var done = Boolean(progress.completedModules[key]);
      var unlocked = isModuleUnlocked(branchId, module.module_id, modules, progress);
      var locked = !unlocked;

      return [
        '<article class="lesson-card module-card' + (locked ? ' locked' : '') + '" style="--branch-color:' + escapeAttr(color) + ';">',
        '<div class="lesson-card-body">',
        '<div class="lesson-meta">',
        '<span class="lesson-day">Модуль ' + (module.module_order || "-") + '</span>',
        '<div class="lesson-indicators">',
        (done ? '<span class="status done">Пройдено</span>' : ""),
        (locked ? '<span class="status locked">Закрыт</span>' : (!done ? '<span class="status open">Доступен</span>' : "")),
        '</div>',
        '</div>',
        '<h3>' + escapeHtml(module.title) + '</h3>',
        '<p>' + escapeHtml(module.subtitle || "Описание отсутствует") + '</p>',
        '<div class="lesson-actions">',
        (locked
          ? '<button class="btn btn-open" type="button" disabled>Открыть</button>'
          : '<a class="btn btn-open" href="./lesson.html?id=' + encodeURIComponent(module.module_id) + '">Открыть</a>'),
        '</div>',
        '</div>',
        '</article>'
      ].join("");
    }).join("");
  }

  function extractYouTubeId(url) {
    if (!url) return null;
    var re = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/;
    var match = url.match(re);
    return match ? match[1] : null;
  }

  function isYandexUrl(url) {
    return /(?:disk\.yandex\.ru|yadi\.sk)/i.test(url || "");
  }

  function isYandexEmbedUrl(url) {
    return /(?:embed|iframe|video-player|\/i\/)/i.test(url || "");
  }

  function extractDriveFileId(url) {
    if (!url) return null;

    var byPath = url.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
    if (byPath && byPath[1]) return byPath[1];

    try {
      var parsed = new URL(url);
      var fromId = parsed.searchParams.get("id");
      if (fromId) return fromId;
    } catch (e) {
      return null;
    }

    return null;
  }

  function normalizeMediaUrl(url, type) {
    var value = String(url || "").trim();
    if (!value) return "";

    var driveFileId = extractDriveFileId(value);
    if (driveFileId) {
      if (type === "video") {
        return "https://drive.google.com/file/d/" + driveFileId + "/preview";
      }
      return value;
    }

    if (/drive\.google\.com\/drive\/folders\//i.test(value)) {
      return value;
    }

    if (isYandexUrl(value)) {
      return value;
    }

    if (type === "video") {
      var youtubeId = extractYouTubeId(value);
      if (youtubeId) return "https://www.youtube.com/embed/" + youtubeId;
    }

    return value;
  }

  function getVideoRenderModel(url) {
    var normalized = normalizeMediaUrl(url, "video");
    if (!normalized) return { mode: "none", url: "" };

    if (isYandexUrl(normalized) && !isYandexEmbedUrl(normalized)) {
      return { mode: "link", url: normalized };
    }

    if (/^https:\/\//i.test(normalized)) {
      return { mode: "embed", url: normalized };
    }

    return { mode: "none", url: "" };
  }

  function parseAttachments(raw) {
    if (!raw) return [];

    var lines = String(raw)
      .split(/\r?\n|;/g)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);

    var files = lines.map(function (line, idx) {
      var name = "Материал " + (idx + 1);
      var url = "";

      if (line.indexOf("|") !== -1) {
        var parts = line.split("|").map(function (x) { return x.trim(); });
        var a = parts[0] || "";
        var b = parts[1] || "";

        var aIsUrl = /^https?:\/\//i.test(a);
        var bIsUrl = /^https?:\/\//i.test(b);

        if (aIsUrl && !bIsUrl) { url = a; name = b || name; }
        else if (bIsUrl && !aIsUrl) { url = b; name = a || name; }
        else { name = a || name; url = b || ""; }
      } else {
        url = line;
      }

      url = normalizeMediaUrl(url, "file");
      return { name: name, url: url };
    });

    return files.filter(function (f) {
      return /^https?:\/\//i.test(f.url);
    });
  }

  function getFileExt(nameOrUrl) {
    var v = String(nameOrUrl || "").trim().toLowerCase();
    v = v.split("#")[0].split("?")[0];
    var m = v.match(/\.([a-z0-9]{1,6})$/i);
    return m ? m[1].toUpperCase() : "";
  }

  function getFileTag(file) {
    var ext = getFileExt(file.name);
    if (!ext) ext = getFileExt(file.url);

    if (!ext) return "LINK";
    if (ext === "PDF") return "PDF";
    if (ext === "DOC" || ext === "DOCX") return "DOC";
    if (ext === "XLS" || ext === "XLSX" || ext === "CSV") return "XLS";
    if (ext === "PPT" || ext === "PPTX") return "PPT";
    if (ext === "ZIP" || ext === "RAR" || ext === "7Z") return "ZIP";
    if (ext === "JPG" || ext === "JPEG" || ext === "PNG" || ext === "WEBP") return "IMG";
    return ext;
  }

  function markModuleCompleted(branchId, moduleId, branchModules) {
    var progress = loadProgress();
    var key = getModuleProgressKey(branchId, moduleId);
    progress.completedModules[key] = true;

    if (isBranchCompleted(branchId, branchModules, progress)) {
      progress.completedBranches[branchId] = true;
    }

    saveProgress(progress);
    return progress;
  }

  function renderLesson(modules, branches) {
    var stateBox = document.getElementById("lessonState");
    var main = document.getElementById("lessonMain");
    var id = new URLSearchParams(window.location.search).get("id");

    if (!id) {
      stateBox.classList.remove("skeleton");
      stateBox.textContent = "ID модуля не найден. Откройте урок из списка.";
      return;
    }

    var lesson = modules.find(function (module) {
      return module.module_id === id;
    });

    if (!lesson) {
      stateBox.classList.remove("skeleton");
      stateBox.textContent = "Модуль не найден для выбранного курса.";
      return;
    }

    var branch = branches[lesson.branch_id];
    var branchModules = branch ? branch.modules : [];
    var progress = loadProgress();

    if (!isModuleUnlocked(lesson.branch_id, lesson.module_id, branchModules, progress)) {
      stateBox.classList.remove("skeleton");
      stateBox.textContent = "Этот модуль пока недоступен.";
      return;
    }

    var backUrl = "./branch.html?branch_id=" + encodeURIComponent(lesson.branch_id);
    var topBackLink = document.getElementById("lessonBackLink");
    var lessonCabinetLink = document.getElementById("lessonCabinetLink");
    topBackLink.href = backUrl;
    lessonCabinetLink.href = "./index.html";

    stateBox.hidden = true;
    main.hidden = false;

    document.getElementById("lessonDay").textContent = "Модуль " + (lesson.module_order || "-");
    document.getElementById("lessonTitle").textContent = lesson.title;
    document.getElementById("lessonSubtitle").textContent = lesson.subtitle || "";

    var content = document.getElementById("lessonContent");
    if (lesson.content_html) {
      content.innerHTML = lesson.content_html;
    } else {
      content.textContent = lesson.content_text || "Содержимое урока пока пустое.";
    }

    var videoModel = getVideoRenderModel(lesson.video_url);
    var videoWrap = document.getElementById("videoWrap");
    var frame = document.getElementById("videoFrame");
    var videoLinkCard = document.getElementById("videoLinkCard");
    var videoLinkButton = document.getElementById("videoLinkButton");

    if (videoModel.mode === "embed") {
      frame.setAttribute("allow", "autoplay; encrypted-media; fullscreen; picture-in-picture");
      frame.setAttribute("allowfullscreen", "true");
      frame.setAttribute("playsinline", "true");

      frame.src = videoModel.url;
      videoWrap.hidden = false;
      videoLinkButton.href = videoModel.url;
      videoLinkCard.hidden = false;
    } else if (videoModel.mode === "link") {
      videoWrap.hidden = true;
      frame.removeAttribute("src");
      videoLinkButton.href = videoModel.url;
      videoLinkCard.hidden = false;
    } else {
      videoWrap.hidden = true;
      videoLinkCard.hidden = true;
      frame.removeAttribute("src");
    }

    var attachmentsWrap = document.getElementById("attachmentsWrap");
    var attachmentsList = document.getElementById("attachmentsList");
    var files = parseAttachments(lesson.attachments);

    if (files.length) {
      attachmentsWrap.hidden = false;
      attachmentsList.innerHTML = files.map(function (f) {
        var tag = getFileTag(f);
        return (
          '<li class="attach-item">' +
            '<a class="attach-link" href="' + escapeAttr(f.url) + '" target="_blank" rel="noopener noreferrer">' +
              '<span class="attach-name">' + escapeHtml(f.name) + '</span>' +
              '<span class="file-tag">' + escapeHtml(tag) + '</span>' +
            '</a>' +
          '</li>'
        );
      }).join("");
    } else {
      attachmentsWrap.hidden = true;
      attachmentsList.innerHTML = "";
    }

    var completeBtn = document.getElementById("completeBtn");
    var moduleKey = getModuleProgressKey(lesson.branch_id, lesson.module_id);

    if (progress.completedModules[moduleKey]) {
      completeBtn.textContent = "Пройдено ✓";
      completeBtn.disabled = true;
    }

    completeBtn.addEventListener("click", function () {
      markModuleCompleted(lesson.branch_id, lesson.module_id, branchModules);
      completeBtn.textContent = "Пройдено ✓";
      completeBtn.disabled = true;
      setTimeout(function () {
        window.location.href = backUrl;
      }, 250);
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "");
  }

  function showDashboardLoading() {
    var list = document.getElementById("branchesContainer");
    var box = document.getElementById("stateBox");
    box.hidden = false;
    box.classList.add("skeleton");
    box.textContent = "Загрузка эмоций...";
    list.innerHTML = "";
  }

  function showDashboardError(message) {
    document.getElementById("branchesContainer").innerHTML = "";
    var box = document.getElementById("stateBox");
    box.hidden = false;
    box.classList.remove("skeleton");
    box.textContent = message || "Ошибка загрузки данных";
  }

  async function init() {
    var config = getConfig();
    applyTheme(config);
    initTelegramViewport();

    var page = document.body.getAttribute("data-page");
    if (page === "dashboard") showDashboardLoading();

    try {
      var modules = await fetchModules(config);
      var branches = groupByBranches(modules);
      var progress = loadProgress();

      BRANCH_ORDER.forEach(function (branchId) {
        if (branches[branchId] && isBranchCompleted(branchId, branches[branchId].modules, progress)) {
          progress.completedBranches[branchId] = true;
        }
      });
      saveProgress(progress);

      if (page === "dashboard") {
        renderDashboard(modules, branches, progress, config);
      }

      if (page === "branch") {
        var branchId = new URLSearchParams(window.location.search).get("branch_id");
        renderBranchPage(branchId, branches, progress);
      }

      if (page === "lesson") {
        renderLesson(modules, branches);
      }
    } catch (error) {
      if (page === "dashboard") {
        showDashboardError(error.message || "Ошибка загрузки данных");
      } else if (page === "branch") {
        var state = document.getElementById("branchState");
        state.classList.remove("skeleton");
        state.textContent = error.message || "Не удалось загрузить эмоцию.";
      } else {
        var lessonState = document.getElementById("lessonState");
        lessonState.classList.remove("skeleton");
        lessonState.textContent = error.message || "Не удалось загрузить урок.";
      }
    }
  }

  document.addEventListener("click", function (e) {
    var card = e.target.closest(".lesson-card, .branch-card");
    if (!card) return;
    if (e.target.closest(".btn, a")) return;

    var button = card.querySelector(".btn, .branch-card-link[href]");
    if (button) button.click();
  });

  init();
})();
