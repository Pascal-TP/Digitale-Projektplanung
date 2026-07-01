import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBCE0F_9qFQPl-qEck3RxnHrOZ7mi4p48c",
  authDomain: "digitale-projektplanung.firebaseapp.com",
  projectId: "digitale-projektplanung",
  storageBucket: "digitale-projektplanung.firebasestorage.app",
  messagingSenderId: "436456184614",
  appId: "1:436456184614:web:c6187f6f183e7f3cc83fe7",
  measurementId: "G-HGGN8SQ3NL"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);
let currentUserRole = "view";

const planningRefs = {
  fbh: doc(db, "planning", "fbh"),
  estrich: doc(db, "planning", "estrich")
};

let currentArea = "fbh";
let planningRef = planningRefs[currentArea];
const peopleRefs = {
  fbh: doc(db, "people", "fbh"),
  estrich: doc(db, "people", "estrich")
};

let peopleRef = peopleRefs[currentArea];
const historyRefs = {
  fbh: collection(db, "history", "fbh", "items"),
  estrich: collection(db, "history", "estrich", "items")
};

let historyRef = historyRefs[currentArea];
const countersRef = doc(db, "meta", "counters");
const presenceRef = collection(db, "presence");

function userRef(uid) {
  return doc(db, "users", uid);
}

const DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const year = new Date().getFullYear();
const STORAGE_KEY = "digitaleMagnetwandDemo_v2";

let currentWeek = getCurrentISOWeek();
let data = loadData();
let dragNoteId = null;
let dragMagnetText = null;
let dragMagnetClass = "";
let isRemoteUpdate = false;
let unsubscribePlanning = null;
let unsubscribePeople = null;
let lastOpenUiState = null;
let presenceInterval = null;
let unsubscribePresence = null;
let unsubscribeHistory = null;

const PEOPLE_STORAGE_KEY = "digitaleMagnetwand_people_v1";

let workers = [
  "Kevin", "Marcel", "Andrej", "Sven", "Tom",
  "Monteur 06", "Monteur 07", "Monteur 08", "Monteur 09", "Monteur 10"
];

let vehicles = [
  "Sprinter 1", "Crafter 2", "Anhänger",
  "Fahrzeug 04", "Fahrzeug 05", "Fahrzeug 06"
];

const weekNumber = document.getElementById("weekNumber");
const fbhTemplate = document.getElementById("noteTemplate");
const estrichTemplate = document.getElementById("estrichNoteTemplate");
const columns = [...document.querySelectorAll(".day-column")];

const menuToggle = document.getElementById("menuToggle");

menuToggle.addEventListener("click", () => {
  document.body.classList.toggle("menu-collapsed");

  menuToggle.textContent = document.body.classList.contains("menu-collapsed")
    ? "☰ Menü öffnen"
    : "☰ Menü schließen";
});

document.getElementById("prevWeek").addEventListener("click", () => {
  saveCurrentBoard();
  currentWeek = currentWeek === 1 ? 52 : currentWeek - 1;
  renderWeek();
  updatePresence();
});

document.getElementById("nextWeek").addEventListener("click", () => {
  saveCurrentBoard();
  currentWeek = currentWeek === 52 ? 1 : currentWeek + 1;
  renderWeek();
  updatePresence();
});

document.getElementById("addNote").addEventListener("click", () => addNote("Montag"));

document.getElementById("clearWeek").addEventListener("click", () => {
  if (confirm("Diese Kalenderwoche wirklich leeren?")) {
    data.weeks[currentWeek] = emptyWeek();
    saveData();
    renderWeek();
  }
});

document.getElementById("csvExportButton").addEventListener("click", exportCsv);

document.getElementById("searchInput").addEventListener("input", e => {
  renderSearchResults(e.target.value);
});

document.getElementById("areaFbh").addEventListener("click", () => {
  switchArea("fbh");
});

document.getElementById("areaEstrich").addEventListener("click", () => {
  switchArea("estrich");
});

document.getElementById("addWorker").addEventListener("click", () => {
  addToSlotList("worker");
});

document.getElementById("addVehicle").addEventListener("click", () => {
  addToSlotList("vehicle");
});

document.getElementById("newWorkerName").addEventListener("keydown", e => {
  if (e.key === "Enter") addToSlotList("worker");
});

document.getElementById("newVehicleName").addEventListener("keydown", e => {
  if (e.key === "Enter") addToSlotList("vehicle");
});

columns.forEach(column => {
  column.addEventListener("dragover", e => {
    e.preventDefault();
    column.classList.add("drag-over");
  });

  column.addEventListener("dragleave", () => column.classList.remove("drag-over"));

  column.addEventListener("drop", e => {
    e.preventDefault();
    column.classList.remove("drag-over");

    if (!dragNoteId) return;
    const note = document.querySelector(`[data-note-id="${dragNoteId}"]`);
    if (!note) return;

    column.querySelector(".dropzone").appendChild(note);
    dragNoteId = null;

    if (currentArea === "estrich" && note.classList.contains("estrich-note")) {
      updateEstrichDatesAfterMove(note, column.dataset.day);
      setTimeout(layoutEstrichSpans, 0);
    }

    saveCurrentBoard();

    logHistory(
      "Zettel verschoben",
      `${getNoteLabel(note)} → ${column.dataset.day}, KW ${currentWeek}`
    );
  });
});

function canEdit() {
  return currentUserRole === "full";
}

async function reserveNoteNumber() {
  return await runTransaction(db, async transaction => {
    const snap = await transaction.get(countersRef);

    const nextNumber =
      snap.exists() && typeof snap.data().nextNoteNumber === "number"
        ? snap.data().nextNoteNumber
        : 1;

    transaction.set(countersRef, {
      nextNoteNumber: nextNumber + 1
    }, { merge: true });

    return nextNumber;
  });
}

async function ensureNoteNumbers() {
  let changed = false;

  for (const weekNo of Object.keys(data.weeks || {})) {
    const week = data.weeks[weekNo];

    for (const day of DAYS) {
      for (const note of week[day] || []) {
        if (!note.noteNumber) {
          note.noteNumber = await reserveNoteNumber();
          changed = true;
        }
      }
    }
  }

  if (changed) {
    await saveData();
  }
}

function formatNoteNumber(noteDataOrNumber) {
  const number = typeof noteDataOrNumber === "number"
    ? noteDataOrNumber
    : noteDataOrNumber.noteNumber;

  return number ? String(number).padStart(4, "0") : "????";
}

const FIELD_LABELS = {
  auftraggeber: "Auftraggeber",
  bv: "BV",
  p: "P-",
  ort: "Ort",
  bautraeger: "Bauträger",
  etage: "Etage",
  flaeche: "Fläche",
  hk: "HK",
  rohr: "Rohr",
  termin: "Termin",
  estrich: "Estrich",
  tw: "TW",
  sonstiges: "Sonstiges",
  summe: "Summe Monteure",
  mz: "MZ",
  cl: "PP",
  as: "AS",
  materialliste: "Materialliste",
  angefahren: "Angefahren",
  nurrohr: "Nur Rohr",
  systemrohr: "System + Rohr"
};

function getNoteLabel(noteEl) {
  const number = noteEl.dataset.noteNumber || "????";
  const bvInput = noteEl.querySelector('[data-text-field="bv"]');
  const bv = bvInput && bvInput.value.trim() ? bvInput.value.trim() : "";

  return bv ? `Zettel #${number} – ${bv}` : `Zettel #${number}`;
}

function captureOpenUiState() {
  const openNote = document.querySelector(".note:not(.minimized)");
  if (!openNote) return null;

  const openPanel = openNote.querySelector(".checklist-panel:not(.hidden)");
  const active = document.activeElement;

  return {
    noteId: openNote.dataset.noteId,
    panelType: openPanel ? openPanel.dataset.listPanel : null,
    keyboardMode: openNote.classList.contains("keyboard-mode"),
    eraserMode: openNote.classList.contains("eraser-mode"),
    activeTextField:
      active && active.matches("[data-text-field]")
        ? active.dataset.textField
        : null,
    cursorPosition:
      active && active.matches("[data-text-field]")
        ? active.selectionStart
        : null
  };
}

function restoreOpenUiState(state) {
  if (!state || !state.noteId) return;

  const note = document.querySelector(`[data-note-id="${state.noteId}"]`);
  if (!note) return;

  note.classList.remove("minimized");

  note.querySelectorAll(".checklist-panel").forEach(panel => {
    panel.classList.add("hidden");
  });

  if (state.panelType) {
    const panel = note.querySelector(`[data-list-panel="${state.panelType}"]`);
    if (panel) panel.classList.remove("hidden");
  }

  note.classList.toggle("keyboard-mode", !!state.keyboardMode);
  note.classList.toggle("eraser-mode", !!state.eraserMode);

  const modeButton = note.querySelector(".mode-toggle");
  if (modeButton) {
    modeButton.textContent = state.keyboardMode ? "✏️ Stift" : "⌨ Tastatur";
  }

  const eraserButton = note.querySelector(".eraser-toggle");
  if (eraserButton) {
    eraserButton.textContent = state.eraserMode ? "✎ Schreiben" : "🧽 Radierer";
  }

  if (state.activeTextField) {
    const input = note.querySelector(`[data-text-field="${state.activeTextField}"]`);

    if (input) {
      setTimeout(() => {
        input.focus();

        if (
          input.type !== "radio" &&
          input.type !== "checkbox" &&
          typeof input.setSelectionRange === "function"
        ) {
          const pos = state.cursorPosition ?? input.value.length;
          input.setSelectionRange(pos, pos);
        }
      }, 0);
    }
  }
}

function loadData() {
  return { weeks: {} };
}

async function loadDataFromFirestore() {
  const snap = await getDoc(planningRef);

  if (snap.exists()) {
    data = snap.data();
  } else {
    data = { weeks: {} };
    await saveData();
  }
}

async function saveData() {
  if (isRemoteUpdate) return;
  if (!canEdit()) return;
  await setDoc(planningRef, data);
}

function emptyWeek() {
  const week = {};
  DAYS.forEach(day => week[day] = []);
  return week;
}

function getWeek() {
  if (!data.weeks[currentWeek]) data.weeks[currentWeek] = emptyWeek();
  return data.weeks[currentWeek];
}

function renderWeek(shouldSave = true) {
  weekNumber.textContent = currentWeek;
  columns.forEach(column => column.querySelector(".dropzone").innerHTML = "");

  if (currentArea === "estrich") {
    document.body.classList.add("estrich-area");

    const visibleNotes = getVisibleEstrichNotesForCurrentWeek();

    visibleNotes.forEach(item => {
      createNoteElement(item.day, item.note, {
        sourceWeek: item.sourceWeek,
        isContinuation: item.isContinuation
      });
    });

    updateWeekDates();
    setTimeout(layoutEstrichSpans, 0);
  } else {
    document.body.classList.remove("estrich-area");

    const week = getWeek();
    DAYS.forEach(day => {
      (week[day] || []).forEach(noteData => createNoteElement(day, noteData));
    });

    updateWeekDates();
  }

  if (shouldSave && !isRemoteUpdate) {
    saveData();
  }
}

async function addNote(day, noteData = null) {
  const empty = {
    id: crypto.randomUUID(),
    noteNumber: await reserveNoteNumber(),
    writings: {},
    texts: {},
    checks: {},
    assigned: [],
    minimized: true,
    keyboardMode: true,
    eraserMode: false,
    checklists: {
      bauleitung: Array(15).fill(false),
      prozess: Array(15).fill(false)
    }
  };

  if (currentArea === "estrich") {
    const start = getDateForDayName(day);
    empty.texts.startdate = formatDateInput(start);
    empty.texts.enddate = formatDateInput(start);
    empty.texts.color = "";
  }

  const finalData = noteData || empty;

  if (!finalData.noteNumber) {
    finalData.noteNumber = await reserveNoteNumber();
  }

  getWeek()[day].push(finalData);
  createNoteElement(day, finalData);

  if (currentArea === "estrich") {
    setTimeout(layoutEstrichSpans, 0);
  }

  saveData();

  logHistory("Zettel erstellt", `Zettel #${formatNoteNumber(finalData)} wurde in KW ${currentWeek}, ${day} erstellt`);
}

function createNoteElement(day, noteData, options = {}) {
  const activeTemplate = currentArea === "estrich" ? estrichTemplate : fbhTemplate;
  const clone = activeTemplate.content.firstElementChild.cloneNode(true);
  clone.dataset.noteId = noteData.id;

  clone.dataset.noteNumber = formatNoteNumber(noteData);

  clone.dataset.sourceWeek = options.sourceWeek || currentWeek;

  if (options.isContinuation) {
    clone.classList.add("continuation-note");
  }

  clone.querySelectorAll('input[type="radio"][name="color-PLACEHOLDER"]').forEach(radio => {
    radio.name = `color-${noteData.id}`;
  });

  clone.querySelectorAll(".note-number").forEach(el => {
    el.textContent = formatNoteNumber(noteData);
  });

  if (noteData.minimized !== false) {
    clone.classList.add("minimized");
  }

  const modeButton = clone.querySelector(".mode-toggle");

  if (noteData.keyboardMode !== false) {
    clone.classList.add("keyboard-mode");
    modeButton.textContent = "✏️ Stift";
  } else {
    modeButton.textContent = "⌨ Tastatur";
  }

  if (noteData.eraserMode) {
    clone.classList.add("eraser-mode");
    clone.querySelector(".eraser-toggle").textContent = "✎ Schreiben";
  }

  clone.querySelector(".toggle-note").addEventListener("click", e => {
    e.stopPropagation();

    const isCurrentlyMinimized = clone.classList.contains("minimized");

    if (isCurrentlyMinimized) {
      document.querySelectorAll(".note:not(.minimized)").forEach(openNote => {
        if (openNote !== clone) {
          openNote.classList.add("minimized");

          openNote.querySelectorAll(".checklist-panel").forEach(panel => {
            panel.classList.add("hidden");
          });
        }
      });

      clone.classList.remove("minimized");
    } else {
      clone.querySelectorAll(".checklist-panel").forEach(panel => {
        panel.classList.add("hidden");
      });

      clone.classList.add("minimized");
    }

    saveCurrentBoard();

    if (currentArea === "estrich") {
      setTimeout(layoutEstrichSpans, 0);
    }
  });

  clone.addEventListener("dragstart", e => {
    if (e.target.closest("canvas, button, .assigned, input")) {
      e.preventDefault();
      return;
    }
    dragNoteId = noteData.id;
  });

  clone.addEventListener("dragend", () => {
    dragNoteId = null;
    saveCurrentBoard();
  });

  clone.querySelectorAll("[data-check]").forEach(input => {
    const key = input.dataset.check;
    input.checked = !!(noteData.checks && noteData.checks[key]);
    input.addEventListener("change", () => {
      saveCurrentBoard();

      logHistory(
        "Statusfeld geändert",
        `${getNoteLabel(clone)} · ${FIELD_LABELS[key] || key}: ${input.checked ? "aktiviert" : "deaktiviert"}`
      );
    });
  });

  clone.querySelectorAll("canvas[data-field]").forEach(canvas => {
    const key = canvas.dataset.field;
    setupWritingCanvas(canvas, noteData.writings ? noteData.writings[key] : "");
  });

  clone.querySelectorAll("[data-text-field]").forEach(input => {
    const key = input.dataset.textField;
    if (input.type === "radio") {
      input.checked = (noteData.texts ? noteData.texts[key] || "" : "") === input.value;
    } else {
      input.value = noteData.texts ? noteData.texts[key] || "" : "";
    }

    input.dataset.oldValue = input.type === "radio"
      ? String(input.checked)
      : input.value;

    input.addEventListener("focus", () => {
      input.dataset.oldValue = input.value;
    });

    input.addEventListener("blur", () => {
      const oldValue = input.dataset.oldValue || "";
      const newValue = input.value || "";

      if (oldValue !== newValue) {
        logHistory(
          "Eingabefeld geändert",
          `${getNoteLabel(clone)} · ${FIELD_LABELS[key] || key}: "${oldValue}" → "${newValue}"`
        );

        input.dataset.oldValue = newValue;
      }
    });

    input.addEventListener("input", () => {
      updateCompactView(clone);

      if (currentArea === "estrich" && (key === "startdate" || key === "enddate" || key === "color")) {
        moveEstrichNoteToStartDay(clone);
        setTimeout(layoutEstrichSpans, 0);
      }

      saveCurrentBoard();
    });

    input.addEventListener("change", () => {
      updateCompactView(clone);

      if (currentArea === "estrich" && key === "color") {
        applyNoteColor(clone);
        saveCurrentBoard();
      }
    });
  });

  modeButton.addEventListener("click", e => {
    e.stopPropagation();

    clone.classList.toggle("keyboard-mode");
    clone.classList.remove("eraser-mode");

    modeButton.textContent = clone.classList.contains("keyboard-mode")
      ? "✏️ Stift"
      : "⌨ Tastatur";

    const eraserButton = clone.querySelector(".eraser-toggle");
    eraserButton.textContent = "🧽 Radierer";

    saveCurrentBoard();
  });

  clone.querySelector(".eraser-toggle").addEventListener("click", e => {
    e.stopPropagation();

    clone.classList.toggle("eraser-mode");
    clone.classList.remove("keyboard-mode");

    const btn = clone.querySelector(".eraser-toggle");
    btn.textContent = clone.classList.contains("eraser-mode")
      ? "✎ Schreiben"
      : "🧽 Radierer";
  });

  const assigned = clone.querySelector(".assigned");
  assigned.addEventListener("dragover", e => e.preventDefault());
  assigned.addEventListener("drop", e => {
    e.preventDefault();
    if (!dragMagnetText) return;

    const item = { text: dragMagnetText, cls: dragMagnetClass };
    const current = readAssigned(assigned);

    if (!current.some(x => x.text === item.text)) {
      current.push(item);
      renderAssigned(assigned, current);
      updateCompactView(clone);
      saveCurrentBoard();

      logHistory("Zuordnung geändert", `${item.text} wurde einem Zettel zugeordnet`);
    }
  });
  renderAssigned(assigned, noteData.assigned || []);

  const absentAssigned = clone.querySelector(".absent-assigned");
  if (absentAssigned) {
    absentAssigned.addEventListener("dragover", e => e.preventDefault());
    absentAssigned.addEventListener("drop", e => {
      e.preventDefault();
      if (!dragMagnetText) return;

      const item = { text: dragMagnetText, cls: dragMagnetClass };
      const current = readAssigned(absentAssigned);

      if (!current.some(x => x.text === item.text)) {
        current.push(item);
        renderAssigned(absentAssigned, current);
        saveCurrentBoard();
        logHistory("Abwesenheit geändert", `${item.text} wurde als abwesend eingetragen`);
      }
    });

    renderAssigned(absentAssigned, noteData.absent || []);
  }

  clone.querySelector(".clear-writing").addEventListener("click", () => {
    clone.querySelectorAll("canvas[data-field]").forEach(clearCanvas);
    saveCurrentBoard();
  });

  clone.querySelector(".delete").addEventListener("click", () => {
    const label = getNoteLabel(clone);

    clone.remove();
    saveCurrentBoard();

    logHistory("Zettel gelöscht", `${label} wurde gelöscht`);
  });

  clone.querySelector(".duplicate").addEventListener("click", async () => {
    saveCurrentBoard();

    const copy = collectNote(clone);
    copy.id = crypto.randomUUID();
    copy.noteNumber = await reserveNoteNumber();

    getWeek()[day].push(copy);
    createNoteElement(day, copy);
    saveData();

    logHistory("Zettel kopiert", `${getNoteLabel(clone)} wurde als Zettel #${formatNoteNumber(copy)} kopiert`);
  });

  setupChecklists(clone, noteData);
  updateCompactView(clone);

  document.querySelector(`[data-day="${day}"] .dropzone`).appendChild(clone);
}

function setupWritingCanvas(canvas, imageData) {
  const ctx = canvas.getContext("2d");
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#164a8a";
  ctx.globalCompositeOperation = "source-over";
  if (imageData) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0);
    img.src = imageData;
  }

  let drawing = false;
  let last = null;

  function point(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  canvas.addEventListener("pointerdown", e => {
    e.preventDefault();
    drawing = true;
    last = point(e);
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", e => {
    if (!drawing) return;
    const p = point(e);
    ctx.beginPath();
    const isEraser = canvas.closest(".note").classList.contains("eraser-mode");

    ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
    ctx.lineWidth = isEraser ? 18 : 3;
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  });

  canvas.addEventListener("pointerup", () => {
    drawing = false;
    last = null;
    saveCurrentBoard();

    const note = canvas.closest(".note");
    const field = canvas.dataset.field;

    if (note) {
      logHistory(
        "Handschrift geändert",
        `${getNoteLabel(note)} · ${FIELD_LABELS[field] || field}`
      );
    }
  });

  canvas.addEventListener("pointercancel", () => {
    drawing = false;
    last = null;
  });

  canvas.addEventListener("dblclick", () => {
    clearCanvas(canvas);
    saveCurrentBoard();

    const note = canvas.closest(".note");
    const field = canvas.dataset.field;

    if (note) {
      logHistory(
        "Handschrift gelöscht",
        `${getNoteLabel(note)} · ${FIELD_LABELS[field] || field}`
      );
    }
  });
}

function clearCanvas(canvas) {
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
}

function renderAssigned(container, items) {
  container.innerHTML = "";

  items.forEach(item => {
    const el = document.createElement("span");
    el.className = "magnet " + (item.cls || "");
    el.textContent = item.text;
    el.title = "Doppelklick zum Entfernen";

    el.addEventListener("dblclick", () => {
      const note = el.closest(".note");
      const label = note ? getNoteLabel(note) : "Zettel";
      const removedText = el.textContent.trim();
      const type = el.classList.contains("vehicle") ? "Fahrzeug" : "Monteur";

      el.remove();

      if (note) {
        updateCompactView(note);
      }

      saveCurrentBoard();

      logHistory(
        "Zuordnung entfernt",
        `${label} · ${type} "${removedText}" entfernt`
      );
    });

    container.appendChild(el);
  });
}

function readAssigned(container) {
  return [...container.querySelectorAll(".magnet")].map(el => ({
    text: el.textContent.trim(),
    cls: el.classList.contains("vehicle") ? "vehicle" : ""
  }));
}

function setupChecklists(noteEl, noteData) {
  const lists = ["bauleitung", "prozess"];

  lists.forEach(type => {
    if (!noteData.checklists) noteData.checklists = {};
    if (!noteData.checklists[type]) noteData.checklists[type] = Array(15).fill(false);

    const container = noteEl.querySelector(`[data-list="${type}"]`);
    if (!container) return;
    container.innerHTML = "";

    for (let i = 0; i < 15; i++) {
      const label = document.createElement("label");
      label.innerHTML = `
        <input type="checkbox" data-checklist="${type}" data-index="${i}">
        Punkt ${i + 1} – Textblocker
      `;

      const input = label.querySelector("input");
      input.checked = !!noteData.checklists[type][i];

      input.addEventListener("change", () => {
        updateTrafficLights(noteEl);
        saveCurrentBoard();

        const listName = type === "bauleitung" ? "Bauleitung" : "Prozess";
        const status = input.checked ? "erledigt" : "offen";

        logHistory(
          "Checkliste geändert",
          `${getNoteLabel(noteEl)} · ${listName} · Punkt ${i + 1}: ${status}`
        );
      });

      container.appendChild(label);
    }
  });

  noteEl.querySelectorAll("[data-list-button]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();

      const type = btn.dataset.listButton;
      noteEl.classList.remove("minimized");

      noteEl.querySelectorAll(".checklist-panel").forEach(panel => {
        panel.classList.add("hidden");
      });

      const panel = noteEl.querySelector(`[data-list-panel="${type}"]`);
      panel.classList.toggle("hidden");
    });
  });

  updateTrafficLights(noteEl);
}

function updateTrafficLights(noteEl) {
  ["bauleitung", "prozess"].forEach(type => {
    const boxes = [...noteEl.querySelectorAll(`[data-checklist="${type}"]`)];
    const checked = boxes.filter(box => box.checked).length;

    noteEl.querySelectorAll(`[data-list-button="${type}"]`).forEach(btn => {
      btn.classList.remove("traffic-red", "traffic-orange", "traffic-green");

      if (checked === 0) {
        btn.classList.add("traffic-red");
      } else if (checked === boxes.length) {
        btn.classList.add("traffic-green");
      } else {
        btn.classList.add("traffic-orange");
      }
    });
  });
}

function updateCompactView(noteEl) {
  const bvCanvas = noteEl.querySelector('canvas[data-field="bv"]');
  const compactBv = noteEl.querySelector(".compact-bv");

  if (compactBv) {
    const bvInput = noteEl.querySelector('[data-text-field="bv"]');
    compactBv.textContent = bvInput && bvInput.value.trim()
      ? bvInput.value.trim()
      : "Bauvorhaben";
  }

  const source = noteEl.querySelector(".assigned");
  const target = noteEl.querySelector(".compact-assigned");

  if (source && target) {
    target.innerHTML = source.innerHTML;
  }

  const compactDate = noteEl.querySelector("[data-compact-date]");
  if (compactDate) {
    const start = noteEl.querySelector('[data-text-field="startdate"]')?.value || "";
    const end = noteEl.querySelector('[data-text-field="enddate"]')?.value || "";

    compactDate.textContent = start && end
      ? `${formatDisplayDate(start)} bis ${formatDisplayDate(end)}`
      : "-";
  }

  applyNoteColor(noteEl);
}

function collectNote(noteEl) {
  const writings = {};
  noteEl.querySelectorAll("canvas[data-field]").forEach(canvas => {
    writings[canvas.dataset.field] = canvas.toDataURL("image/png");
  });

  const texts = {};
  noteEl.querySelectorAll("[data-text-field]").forEach(input => {
    const key = input.dataset.textField;

    if (input.type === "radio") {
      if (input.checked) {
        texts[key] = input.value;
      }
      return;
    }

    texts[key] = input.value;
  });

  const checks = {};
  noteEl.querySelectorAll("[data-check]").forEach(input => {
    checks[input.dataset.check] = input.checked;
  });

  const checklists = {
    bauleitung: [],
    prozess: []
  };

  noteEl.querySelectorAll('[data-checklist="bauleitung"]').forEach(box => {
    checklists.bauleitung[Number(box.dataset.index)] = box.checked;
  });

  noteEl.querySelectorAll('[data-checklist="prozess"]').forEach(box => {
    checklists.prozess[Number(box.dataset.index)] = box.checked;
  });

  return {
    id: noteEl.dataset.noteId,
    noteNumber: Number(noteEl.dataset.noteNumber),
    keyboardMode: noteEl.classList.contains("keyboard-mode"),
    eraserMode: noteEl.classList.contains("eraser-mode"),
    writings,
    texts,
    checks,
    assigned: readAssigned(noteEl.querySelector(".assigned")),
    absent: noteEl.querySelector(".absent-assigned")
      ? readAssigned(noteEl.querySelector(".absent-assigned"))
      : [],
    minimized: noteEl.classList.contains("minimized"),
    checklists
  };
}

function saveCurrentBoard() {
  const week = emptyWeek();

  columns.forEach(column => {
    const day = column.dataset.day;
    column.querySelectorAll(".note").forEach(noteEl => {
      const sourceWeek = Number(noteEl.dataset.sourceWeek || currentWeek);

      if (currentArea === "estrich" && sourceWeek !== currentWeek) {
        return;
      }

      week[day].push(collectNote(noteEl));
    });
  });

  data.weeks[currentWeek] = week;
  saveData();
}

function makeTextImage(text, width, height) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#164a8a";
  ctx.font = "bold 18px Segoe Print, Comic Sans MS, Arial";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 8, height / 2 + 2);
  return c.toDataURL("image/png");
}

window.addEventListener("beforeunload", saveCurrentBoard);

document.getElementById("loginButton").addEventListener("click", async () => {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch {
    document.getElementById("loginError").textContent = "Anmeldung fehlgeschlagen.";
  }
});

document.getElementById("logoutButton").addEventListener("click", async () => {
  await removePresence();
  signOut(auth);
});

onAuthStateChanged(auth, async user => {
  if (!user) {
    document.getElementById("loginScreen").classList.remove("hidden");
    return;
  }

  const snap = await getDoc(userRef(user.uid));

  currentUserRole = snap.exists() && snap.data().role === "full"
    ? "full"
    : "view";

  document.body.classList.toggle("view-only", currentUserRole === "view");
  document.getElementById("loginScreen").classList.add("hidden");

  startApp();
});

async function startApp() {
  await loadDataFromFirestore();
  await loadPeople();
  await ensureNoteNumbers();

  renderSlotLists();
  renderWeek(false);

  subscribeToRealtimeUpdates();
  subscribeToHistory();

  startPresence();
  subscribeToPresence();
}

function updateWeekDates() {

  const monday = getMondayOfISOWeek(currentWeek, year);

  document.querySelectorAll(".day-column").forEach((column, index) => {

    const date = new Date(monday);

    date.setDate(monday.getDate() + index);

    const txt =
      String(date.getDate()).padStart(2, "0") + "." +
      String(date.getMonth() + 1).padStart(2, "0") + ".";

    column.querySelector(".day-date").textContent = txt;

  });

}

function getMondayOfISOWeek(week, year) {

  const simple = new Date(year, 0, 1 + (week - 1) * 7);

  const dow = simple.getDay();

  const monday = new Date(simple);

  if (dow <= 4)
    monday.setDate(simple.getDate() - simple.getDay() + 1);
  else
    monday.setDate(simple.getDate() + 8 - simple.getDay());

  return monday;

}

function renderSlotLists() {
  renderOneSlotList("workerList", workers, "");
  renderOneSlotList("vehicleList", vehicles, "vehicle");
}

function renderOneSlotList(containerId, items, cls) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  items.forEach(name => {
    const el = document.createElement("div");
    el.dataset.sourceType = cls === "vehicle" ? "vehicle" : "worker";
    el.className = "magnet " + cls;
    el.draggable = true;
    el.textContent = name;

    el.addEventListener("dragstart", e => {
      dragMagnetText = name;
      dragMagnetClass = cls;
      e.dataTransfer.setData("text/plain", name);
    });

    el.addEventListener("dragend", () => {
      dragMagnetText = null;
      dragMagnetClass = "";
    });

    container.appendChild(el);
  });
}

function addToSlotList(type) {
  const input = type === "worker"
    ? document.getElementById("newWorkerName")
    : document.getElementById("newVehicleName");

  const value = input.value.trim();
  if (!value) return;

  const list = type === "worker" ? workers : vehicles;

  if (!list.includes(value)) {
    list.push(value);
    list.sort((a, b) => a.localeCompare(b, "de"));
    savePeople();
    renderSlotLists();
  }

  input.value = "";
}

async function savePeople() {
  if (!canEdit()) return;
  await setDoc(peopleRef, {
    workers,
    vehicles
  });
}

async function loadPeople() {
  const snap = await getDoc(peopleRef);

  if (snap.exists()) {
    const saved = snap.data();

    if (Array.isArray(saved.workers)) workers = saved.workers;
    if (Array.isArray(saved.vehicles)) vehicles = saved.vehicles;
  } else {
    await savePeople();
  }
}

const trashBin = document.getElementById("trashBin");

trashBin.addEventListener("dragover", e => {
  e.preventDefault();
  trashBin.classList.add("drag-over");
});

trashBin.addEventListener("dragleave", () => {
  trashBin.classList.remove("drag-over");
});

trashBin.addEventListener("drop", e => {
  e.preventDefault();
  trashBin.classList.remove("drag-over");

  if (!dragMagnetText) return;

  const confirmed = confirm(`"${dragMagnetText}" wirklich aus der Liste löschen?`);
  if (!confirmed) return;

  workers = workers.filter(name => name !== dragMagnetText);
  vehicles = vehicles.filter(name => name !== dragMagnetText);

  savePeople();
  renderSlotLists();

  dragMagnetText = null;
  dragMagnetClass = "";
});

setupWeekDrop("prevWeekDrop", -1);
setupWeekDrop("nextWeekDrop", 1);

function setupWeekDrop(elementId, direction) {
  const el = document.getElementById(elementId);
  if (!el) return;

  el.addEventListener("dragover", e => {
    e.preventDefault();
    el.classList.add("drag-over");
  });

  el.addEventListener("dragleave", () => {
    el.classList.remove("drag-over");
  });

  el.addEventListener("drop", e => {
    e.preventDefault();
    el.classList.remove("drag-over");

    if (!dragNoteId) return;

    saveCurrentBoard();

    const current = getWeek();
    let movedNote = null;

    for (const day of DAYS) {
      const index = current[day].findIndex(note => note.id === dragNoteId);
      if (index !== -1) {
        movedNote = current[day].splice(index, 1)[0];
        break;
      }
    }

    if (!movedNote) return;

    const oldStart = movedNote.texts?.startdate || "";
    const oldEnd = movedNote.texts?.enddate || oldStart;
    const durationDays = getDateDurationDays(oldStart, oldEnd);

    let targetWeekNumber = currentWeek + direction;

    if (targetWeekNumber < 1) targetWeekNumber = 52;
    if (targetWeekNumber > 52) targetWeekNumber = 1;

    if (currentArea === "estrich") {
      const targetMonday = getMondayOfISOWeek(targetWeekNumber, year);
      movedNote.texts = movedNote.texts || {};
      movedNote.texts.startdate = formatDateInput(targetMonday);

      const newEnd = new Date(targetMonday);
      newEnd.setDate(targetMonday.getDate() + durationDays);
      movedNote.texts.enddate = formatDateInput(newEnd);
    }

    if (!data.weeks[targetWeekNumber]) {
      data.weeks[targetWeekNumber] = emptyWeek();
    }

    data.weeks[targetWeekNumber]["Montag"].push(movedNote);

    saveData();
    dragNoteId = null;

    logHistory(
      "Zettel in andere KW verschoben",
      `Zettel #${formatNoteNumber(movedNote)} → KW ${targetWeekNumber}`
    );

    renderWeek();
  });
}

function subscribeToRealtimeUpdates() {
  unsubscribePlanning = onSnapshot(planningRef, snap => {
    if (!snap.exists()) return;

    lastOpenUiState = captureOpenUiState();

    isRemoteUpdate = true;
    data = snap.data();
    renderWeek(false);
    restoreOpenUiState(lastOpenUiState);
    isRemoteUpdate = false;
  });

  unsubscribePeople = onSnapshot(peopleRef, snap => {
    if (!snap.exists()) return;

    const saved = snap.data();

    if (Array.isArray(saved.workers)) workers = saved.workers;
    if (Array.isArray(saved.vehicles)) vehicles = saved.vehicles;

    renderSlotLists();
  });
}

document.getElementById("historyButton").addEventListener("click", () => {
  document.getElementById("historyPanel").classList.toggle("hidden");
});

document.getElementById("historyClose").addEventListener("click", () => {
  document.getElementById("historyPanel").classList.add("hidden");
});

async function logHistory(action, details = "") {
  if (!canEdit()) return;

  await addDoc(historyRef, {
    action,
    details,
    area: currentArea,
    week: currentWeek,
    userEmail: auth.currentUser ? auth.currentUser.email : "",
    createdAt: serverTimestamp()
  });
}

function subscribeToHistory() {
  const q = query(historyRef, orderBy("createdAt", "desc"), limit(50));

  unsubscribeHistory = onSnapshot(q, snapshot => {
    const list = document.getElementById("historyList");
    list.innerHTML = "";

    snapshot.forEach(docSnap => {
      const item = docSnap.data();

      const date = item.createdAt && item.createdAt.toDate
        ? item.createdAt.toDate().toLocaleString("de-DE")
        : "";

      const div = document.createElement("div");
      div.className = "history-item";
      div.innerHTML = `
        <strong>${item.action}</strong>
        <div>${item.details || ""}</div>
        <div class="history-meta">${date} · ${item.userEmail || "Unbekannt"} · KW ${item.week || "-"}</div>
      `;

      list.appendChild(div);
    });
  });
}

function getCurrentISOWeek() {
  const now = new Date();
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  const dayNumber = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);

  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));

  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

async function updatePresence() {
  if (!auth.currentUser) return;

  await setDoc(doc(db, "presence", auth.currentUser.uid), {
    email: auth.currentUser.email || "Unbekannt",
    week: currentWeek,
    area: currentArea,
    role: currentUserRole,
    lastSeenMs: Date.now(),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

function startPresence() {
  updatePresence();

  if (presenceInterval) clearInterval(presenceInterval);

  presenceInterval = setInterval(() => {
    updatePresence();
  }, 30000);
}

async function removePresence() {
  if (!auth.currentUser) return;

  try {
    await deleteDoc(doc(db, "presence", auth.currentUser.uid));
  } catch {
    // Beim Schließen/Logout nicht kritisch
  }
}

function subscribeToPresence() {
  if (unsubscribePresence) unsubscribePresence();

  unsubscribePresence = onSnapshot(presenceRef, snapshot => {
    const container = document.getElementById("onlineUsers");
    if (!container) return;

    container.innerHTML = "";

    const now = Date.now();
    const activeUsers = [];

    snapshot.forEach(docSnap => {
      const user = docSnap.data();

      if (!user.lastSeenMs) return;
      if (now - user.lastSeenMs > 120000) return;

      activeUsers.push(user);
    });

    activeUsers
      .sort((a, b) => (a.email || "").localeCompare(b.email || "", "de"))
      .forEach(user => {
        const div = document.createElement("div");
        div.className = "online-user";

        div.innerHTML = `
          <span class="online-dot"></span>
          <div>
            <div>${user.email || "Unbekannt"}</div>
            <div class="online-meta">${user.area === "estrich" ? "Estrich" : "FBH"} · KW ${user.week || "-"} · ${user.role === "full" ? "Vollzugriff" : "Ansicht"}</div>
          </div>
        `;

        container.appendChild(div);
      });

    if (activeUsers.length === 0) {
      container.innerHTML = `<div class="online-meta">Niemand online</div>`;
    }
  });
}

window.addEventListener("beforeunload", () => {
  removePresence();
});

function exportCsv() {
  saveCurrentBoard();

  const rows = [];

  rows.push([
    "KW",
    "Tag",
    "Zettel-Nr",
    "Auftraggeber",
    "BV",
    "P-Nr",
    "Ort",
    "Bauträger",
    "Etage",
    "Fläche",
    "HK",
    "Rohr",
    "Termin",
    "Estrich",
    "TW",
    "Sonstiges",
    "Summe Monteure",
    "MZ",
    "PP",
    "AS",
    "Materialliste",
    "Angefahren",
    "Nur Rohr",
    "System + Rohr",
    "Monteure/Fahrzeuge"
  ]);

  Object.keys(data.weeks || {}).forEach(weekNo => {
    const week = data.weeks[weekNo];

    DAYS.forEach(day => {
      (week[day] || []).forEach(note => {
        const t = note.texts || {};
        const c = note.checks || {};
        const assigned = (note.assigned || []).map(x => x.text).join(", ");

        rows.push([
          weekNo,
          day,
          formatNoteNumber(note),
          t.auftraggeber || "",
          t.bv || "",
          t.p || "",
          t.ort || "",
          t.bautraeger || "",
          t.etage || "",
          t.flaeche || "",
          t.hk || "",
          t.rohr || "",
          t.termin || "",
          t.estrich || "",
          t.tw || "",
          t.sonstiges || "",
          t.summe || "",
          c.mz ? "ja" : "nein",
          c.cl ? "ja" : "nein",
          c.as ? "ja" : "nein",
          c.materialliste ? "ja" : "nein",
          c.angefahren ? "ja" : "nein",
          c.nurrohr ? "ja" : "nein",
          c.systemrohr ? "ja" : "nein",
          assigned
        ]);
      });
    });
  });

  const csv = rows
    .map(row => row.map(csvCell).join(";"))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = `digitale-projektplanung-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();

  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function findNotes(searchTerm) {
  const term = searchTerm.trim().toLowerCase();
  if (!term) return [];

  const results = [];

  Object.keys(data.weeks || {}).forEach(weekNo => {
    const week = data.weeks[weekNo];

    DAYS.forEach(day => {
      (week[day] || []).forEach(note => {
        const texts = note.texts || {};
        const number = formatNoteNumber(note).toLowerCase();
        const p = (texts.p || "").toLowerCase();
        const bv = (texts.bv || "").toLowerCase();

        if (
          number.includes(term) ||
          p.includes(term) ||
          bv.includes(term)
        ) {
          results.push({
            weekNo: Number(weekNo),
            day,
            noteId: note.id,
            noteNumber: formatNoteNumber(note),
            p: texts.p || "",
            bv: texts.bv || ""
          });
        }
      });
    });
  });

  return results;
}

function renderSearchResults(searchTerm) {
  const box = document.getElementById("searchResults");
  const results = findNotes(searchTerm);

  box.innerHTML = "";

  if (!searchTerm.trim()) {
    box.classList.add("hidden");
    return;
  }

  if (results.length === 0) {
    box.innerHTML = `<div class="search-result-item">Keine Treffer gefunden</div>`;
    box.classList.remove("hidden");
    return;
  }

  results.slice(0, 20).forEach(result => {
    const div = document.createElement("div");
    div.className = "search-result-item";

    div.innerHTML = `
      <strong>Zettel #${result.noteNumber} · KW ${result.weekNo} · ${result.day}</strong>
      <div>P-Nr.: ${result.p || "-"} · BV: ${result.bv || "-"}</div>
    `;

    div.addEventListener("click", () => {
      openSearchResult(result);
    });

    box.appendChild(div);
  });

  box.classList.remove("hidden");
}

function openSearchResult(result) {
  saveCurrentBoard();

  currentWeek = result.weekNo;
  renderWeek(false);
  updatePresence();

  document.getElementById("searchResults").classList.add("hidden");
  document.getElementById("searchInput").value = "";

  setTimeout(() => {
    const note = document.querySelector(`[data-note-id="${result.noteId}"]`);
    if (!note) return;

    document.querySelectorAll(".note:not(.minimized)").forEach(openNote => {
      openNote.classList.add("minimized");
    });

    note.classList.remove("minimized");
    note.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center"
    });
  }, 50);
}

async function switchArea(area) {
  if (area === currentArea) return;

  saveCurrentBoard();

  currentArea = area;
  planningRef = planningRefs[currentArea];
  peopleRef = peopleRefs[currentArea];
  historyRef = historyRefs[currentArea];

  document.getElementById("areaFbh").classList.toggle("active", currentArea === "fbh");
  document.getElementById("areaEstrich").classList.toggle("active", currentArea === "estrich");

  data = { weeks: {} };

  if (unsubscribePlanning) unsubscribePlanning();
  if (unsubscribePeople) unsubscribePeople();
  if (unsubscribeHistory) unsubscribeHistory();

  await loadDataFromFirestore();
  await loadPeople();
  await ensureNoteNumbers();

  renderSlotLists();
  renderWeek(false);

  subscribeToRealtimeUpdates();
  subscribeToHistory();

  updatePresence();

  logHistory("Bereich gewechselt", currentArea === "fbh" ? "FBH" : "Estrich");
}

function getDateForDayName(dayName) {
  const monday = getMondayOfISOWeek(currentWeek, year);
  const index = DAYS.indexOf(dayName);
  const date = new Date(monday);
  date.setDate(monday.getDate() + Math.max(0, index));
  return date;
}

function formatDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDisplayDate(value) {
  if (!value) return "";
  const [y, m, d] = value.split("-");
  return `${d}.${m}.`;
}

function parseInputDate(value) {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function getDayIndexFromDate(value) {
  const date = parseInputDate(value);
  if (!date) return 0;

  const monday = getMondayOfISOWeek(currentWeek, year);
  const diff = Math.round((date - monday) / 86400000);

  return Math.min(5, Math.max(0, diff));
}

function moveEstrichNoteToStartDay(noteEl) {
  const start = noteEl.querySelector('[data-text-field="startdate"]')?.value;
  const index = getDayIndexFromDate(start);
  const targetDay = DAYS[index];
  const targetDropzone = document.querySelector(`[data-day="${targetDay}"] .dropzone`);

  if (targetDropzone && !targetDropzone.contains(noteEl)) {
    targetDropzone.appendChild(noteEl);
  }
}

function applyNoteColor(noteEl) {
  if (!noteEl.classList.contains("estrich-note")) return;

  const checkedColor = noteEl.querySelector('[data-text-field="color"]:checked');
  const color = checkedColor ? checkedColor.value : "";

  noteEl.classList.remove(
    "estrich-color-grey",
    "estrich-color-blue",
    "estrich-color-green",
    "estrich-color-red"
  );

  if (color) {
    noteEl.classList.add(`estrich-color-${color}`);
  }
}

function layoutEstrichSpans() {
  if (currentArea !== "estrich") return;

  const cols = [...document.querySelectorAll(".day-column")];
  const weekStart = getMondayOfISOWeek(currentWeek, year);
  const weekEnd = addDays(weekStart, DAYS.length - 1);

  document.querySelectorAll(".estrich-note:not(.minimized)").forEach(note => {
    note.style.position = "relative";
    note.style.left = "";
    note.style.top = "";
    note.style.width = "";
    note.style.display = "";
    note.style.zIndex = "50";
  });

  const notes = [...document.querySelectorAll(".estrich-note.minimized")];

  notes.forEach((note, lane) => {
    const startValue = note.querySelector('[data-text-field="startdate"]')?.value;
    const endValue = note.querySelector('[data-text-field="enddate"]')?.value || startValue;

    const realStart = parseInputDate(startValue);
    const realEnd = parseInputDate(endValue);

    if (!realStart || !realEnd) return;

    const visibleStart = realStart < weekStart ? weekStart : realStart;
    const visibleEnd = realEnd > weekEnd ? weekEnd : realEnd;

    if (visibleEnd < weekStart || visibleStart > weekEnd) {
      note.style.display = "none";
      return;
    }

    note.style.display = "";

    const startIndex = Math.max(0, Math.min(5, Math.round((visibleStart - weekStart) / 86400000)));
    const endIndex = Math.max(startIndex, Math.min(5, Math.round((visibleEnd - weekStart) / 86400000)));

    const startCol = cols[startIndex];
    const endCol = cols[endIndex];

    const left = startCol.offsetLeft + 12;
    const right = endCol.offsetLeft + endCol.offsetWidth - 12;
    const top = startCol.querySelector("h2").offsetHeight + 34 + lane * 105;

    note.style.position = "absolute";
    note.style.left = `${left}px`;
    note.style.top = `${top}px`;
    note.style.width = `${right - left}px`;
    note.style.zIndex = "20";
  });
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function getDateDurationDays(startValue, endValue) {
  const start = parseInputDate(startValue);
  const end = parseInputDate(endValue);

  if (!start || !end) return 0;

  return Math.max(0, Math.round((end - start) / 86400000));
}

function updateEstrichDatesAfterMove(noteEl, targetDayName) {
  const oldStartValue = noteEl.querySelector('[data-text-field="startdate"]')?.value;
  const oldEndValue = noteEl.querySelector('[data-text-field="enddate"]')?.value || oldStartValue;

  const durationDays = getDateDurationDays(oldStartValue, oldEndValue);
  const newStart = getDateForDayName(targetDayName);
  const newEnd = addDays(newStart, durationDays);

  const startInput = noteEl.querySelector('[data-text-field="startdate"]');
  const endInput = noteEl.querySelector('[data-text-field="enddate"]');

  if (startInput) startInput.value = formatDateInput(newStart);
  if (endInput) endInput.value = formatDateInput(newEnd);

  updateCompactView(noteEl);
}

function getVisibleEstrichNotesForCurrentWeek() {
  const result = [];
  const weekStart = getMondayOfISOWeek(currentWeek, year);
  const weekEnd = addDays(weekStart, DAYS.length - 1);

  Object.keys(data.weeks || {}).forEach(weekNo => {
    const week = data.weeks[weekNo];

    DAYS.forEach(day => {
      (week[day] || []).forEach(note => {
        const startValue = note.texts?.startdate;
        const endValue = note.texts?.enddate || startValue;

        const start = parseInputDate(startValue);
        const end = parseInputDate(endValue);

        if (!start || !end) return;
        if (end < weekStart || start > weekEnd) return;

        const visibleStart = start < weekStart ? weekStart : start;
        const dayIndex = Math.max(
          0,
          Math.min(5, Math.round((visibleStart - weekStart) / 86400000))
        );

        result.push({
          sourceWeek: Number(weekNo),
          day: DAYS[dayIndex],
          note,
          isContinuation: start < weekStart
        });
      });
    });
  });

  return result;
}