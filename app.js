const DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"];
const STORAGE_KEY = "digitaleMagnetwandDemo_v2";

let currentWeek = 1;
let data = loadData();
let dragNoteId = null;
let dragMagnetText = null;
let dragMagnetClass = "";

const weekNumber = document.getElementById("weekNumber");
const template = document.getElementById("noteTemplate");
const columns = [...document.querySelectorAll(".day-column")];

document.getElementById("prevWeek").addEventListener("click", () => {
  saveCurrentBoard();
  currentWeek = currentWeek === 1 ? 52 : currentWeek - 1;
  renderWeek();
});

document.getElementById("nextWeek").addEventListener("click", () => {
  saveCurrentBoard();
  currentWeek = currentWeek === 52 ? 1 : currentWeek + 1;
  renderWeek();
});

document.getElementById("addNote").addEventListener("click", () => addNote("Montag"));
document.getElementById("addSample").addEventListener("click", addSampleNote);

document.getElementById("clearWeek").addEventListener("click", () => {
  if (confirm("Diese Kalenderwoche wirklich leeren?")) {
    data.weeks[currentWeek] = emptyWeek();
    saveData();
    renderWeek();
  }
});

document.querySelectorAll(".toolbox .magnet").forEach(magnet => {
  magnet.addEventListener("dragstart", e => {
    dragMagnetText = magnet.textContent.trim();
    dragMagnetClass = magnet.classList.contains("vehicle") ? "vehicle" : "";
    e.dataTransfer.setData("text/plain", dragMagnetText);
  });
  magnet.addEventListener("dragend", () => {
    dragMagnetText = null;
    dragMagnetClass = "";
  });
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
    saveCurrentBoard();
  });
});

function loadData() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { weeks: {} };
  } catch {
    return { weeks: {} };
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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

function renderWeek() {
  weekNumber.textContent = currentWeek;
  columns.forEach(column => column.querySelector(".dropzone").innerHTML = "");

  const week = getWeek();
  DAYS.forEach(day => {
    (week[day] || []).forEach(noteData => createNoteElement(day, noteData));
  });

  saveData();
}

function addNote(day, noteData = null) {
  const empty = {
    id: crypto.randomUUID(),
    writings: {},
    checks: {},
    assigned: [],
    minimized: true,
    checklists: {
      bauleitung: Array(15).fill(false),
      prozess: Array(15).fill(false)
    }
  };
  const finalData = noteData || empty;
  getWeek()[day].push(finalData);
  createNoteElement(day, finalData);
  saveData();
}

function addSampleNote() {
  addNote("Montag", {
    id: crypto.randomUUID(),
    writings: {
      auftraggeber: makeTextImage("Muster GmbH", 250, 34),
      bv: makeTextImage("Neubau Wohnanlage", 300, 34),
      p: makeTextImage("23-001", 120, 34),
      ort: makeTextImage("Musterstadt", 190, 34),
      bautraeger: makeTextImage("Musterbau AG", 220, 34),
      etage: makeTextImage("EG - 3.OG", 170, 34),
      flaeche: makeTextImage("1.250", 100, 34),
      hk: makeTextImage("1-6", 100, 34),
      rohr: makeTextImage("16x2", 110, 34),
      termin: makeTextImage("KW 3 - KW 6", 230, 34),
      estrich: makeTextImage("ja", 120, 34),
      tw: makeTextImage("nein", 120, 34),
      sonstiges: makeTextImage("Zugang über Hofseite", 650, 38),
      summe: makeTextImage("3", 70, 34)
    },
    checks: {
      mz: true,
      materialliste: true,
      angefahren: true,
      systemrohr: true
    },
    minimized: true,
    checklists: {
      bauleitung: [true, true, false, false, false, false, false, false, false, false, false, false, false, false, false],
      prozess: Array(15).fill(false)
    },
    assigned: [
      { text: "Kevin", cls: "" },
      { text: "Marcel", cls: "" },
      { text: "Sven", cls: "" },
      { text: "Sprinter 1", cls: "vehicle" }
    ]

  });

}

function createNoteElement(day, noteData) {
  const clone = template.content.firstElementChild.cloneNode(true);
  clone.dataset.noteId = noteData.id;

  if (noteData.minimized !== false) {
    clone.classList.add("minimized");
  }

  clone.querySelector(".toggle-note").addEventListener("click", e => {
    e.stopPropagation();
    clone.classList.toggle("minimized");
    saveCurrentBoard();
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
    input.addEventListener("change", saveCurrentBoard);
  });

  clone.querySelectorAll("canvas[data-field]").forEach(canvas => {
    const key = canvas.dataset.field;
    setupWritingCanvas(canvas, noteData.writings ? noteData.writings[key] : "");
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
      saveCurrentBoard();
    }
  });
  renderAssigned(assigned, noteData.assigned || []);

  clone.querySelector(".clear-writing").addEventListener("click", () => {
    clone.querySelectorAll("canvas[data-field]").forEach(clearCanvas);
    saveCurrentBoard();
  });

  clone.querySelector(".delete").addEventListener("click", () => {
    clone.remove();
    saveCurrentBoard();
  });

  clone.querySelector(".duplicate").addEventListener("click", () => {
    saveCurrentBoard();
    const copy = collectNote(clone);
    copy.id = crypto.randomUUID();
    getWeek()[day].push(copy);
    createNoteElement(day, copy);
    saveData();
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
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  });

  canvas.addEventListener("pointerup", () => {
    drawing = false;
    last = null;
    saveCurrentBoard();
  });

  canvas.addEventListener("pointercancel", () => {
    drawing = false;
    last = null;
  });

  canvas.addEventListener("dblclick", () => {
    clearCanvas(canvas);
    saveCurrentBoard();
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
      el.remove();
      saveCurrentBoard();
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
    compactBv.textContent = "Bauvorhaben";
  }

  const source = noteEl.querySelector(".assigned");
  const target = noteEl.querySelector(".compact-assigned");

  if (source && target) {
    target.innerHTML = source.innerHTML;
  }
}

function collectNote(noteEl) {
  const writings = {};
  noteEl.querySelectorAll("canvas[data-field]").forEach(canvas => {
    writings[canvas.dataset.field] = canvas.toDataURL("image/png");
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
    writings,
    checks,
    assigned: readAssigned(noteEl.querySelector(".assigned")),
    minimized: noteEl.classList.contains("minimized"),
    checklists
  };
}

function saveCurrentBoard() {
  const week = emptyWeek();

  columns.forEach(column => {
    const day = column.dataset.day;
    column.querySelectorAll(".note").forEach(noteEl => {
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

renderWeek();

if (Object.values(getWeek()).every(arr => arr.length === 0)) {
  addSampleNote();
}
