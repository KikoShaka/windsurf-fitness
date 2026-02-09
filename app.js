(() => {
  const $ = (id) => document.getElementById(id);

  const workoutSelect = $("workoutSelect");
  const startBtn = $("startBtn");
  const resumeBtn = $("resumeBtn");
  const resetBtn = $("resetBtn");
  const shareBtn = $("shareBtn");
  const themeBtn = $("themeBtn");
  const themeColorMeta = $("themeColorMeta");

  const status = $("status");
  const exerciseCard = $("exerciseCard");
  const doneCard = $("doneCard");

  const workoutTitle = $("workoutTitle");
  const dateText = $("dateText");
  const exTitle = $("exTitle");
  const exMeta = $("exMeta");
  const exCounter = $("exCounter");
  const setTbody = $("setTbody");

  const timerBox = $("timerBox");
  const timerText = $("timerText");
  const skipRestBtn = $("skipRestBtn");
  const stopTimerBtn = $("stopTimerBtn");

  const prevBtn = $("prevBtn");
  const nextBtn = $("nextBtn");

  const doneMeta = $("doneMeta");
  const summaryTotals = $("summaryTotals");
  const summaryWrap = $("summaryWrap");
  const doneResetBtn = $("doneResetBtn");

  const WORKOUTS = window.WORKOUTS || [];

  const STORAGE_STATE_KEY = "wt_state_v3";
  const STORAGE_THEME_KEY = "wt_theme_v1";

  let state = {
    workoutId: null,
    exIndex: 0,
    setIndex: 0,
    doneSets: [],        // boolean[][] [exercise][set]
    logs: [],            // {weight,reps,rir}[][] [exercise][set]
    startedAtISO: null,
    finishedAtISO: null,
    isFinished: false,
  };

  let timer = {
    running: false,
    endAt: 0,
    interval: null,
    restSec: 0,
  };

  // ---------- utils ----------
  function pad2(n) { return String(n).padStart(2, "0"); }

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
  }

  function localDateLabel(iso) {
    const d = iso ? new Date(iso) : new Date();
    return d.toLocaleDateString(undefined, { year: "numeric", month: "numeric", day: "numeric" });
  }

  function durationLabel(startISO, endISO) {
    if (!startISO || !endISO) return "—";
    const ms = Math.max(0, new Date(endISO).getTime() - new Date(startISO).getTime());
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`;
    return `${m}:${pad2(s)}`;
  }

  function flash(msg) {
    status.hidden = false;
    status.textContent = msg;
    clearTimeout(flash._t);
    flash._t = setTimeout(() => (status.hidden = true), 1600);
  }

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.value = 0.06;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      setTimeout(() => { o.stop(); ctx.close(); }, 180);
    } catch {}
  }

  function vibrate(ms = 200) {
    try { navigator.vibrate?.(ms); } catch {}
  }

  function parseNum(v) {
    if (v == null) return NaN;
    const s = String(v).trim().replace(",", ".");
    // allow "22kg" -> 22
    const m = s.match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }

  function getWorkoutById(id) {
    return WORKOUTS.find(w => w.id === id) || null;
  }

  function getCurrentWorkout() {
    return getWorkoutById(state.workoutId);
  }

  function getCurrentExercise() {
    const w = getCurrentWorkout();
    if (!w) return null;
    return w.exercises[state.exIndex] || null;
  }

  function saveState() {
    localStorage.setItem(STORAGE_STATE_KEY, JSON.stringify(state));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_STATE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s?.workoutId) return null;
      return s;
    } catch {
      return null;
    }
  }

  function clearState() {
    localStorage.removeItem(STORAGE_STATE_KEY);
  }

  function setUrlWorkout(id) {
    const url = new URL(window.location.href);
    url.searchParams.set("w", id);
    history.replaceState({}, "", url.toString());
  }

  function copyShareLink() {
    const url = new URL(window.location.href);
    url.searchParams.set("w", state.workoutId || workoutSelect.value);
    const text = url.toString();
    navigator.clipboard?.writeText(text)
      .then(() => flash("Копирах линка ✅"))
      .catch(() => flash("Не успях да копирам — copy ръчно URL-а."));
  }

  // ---------- theme ----------
  function setTheme(theme) {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
      localStorage.setItem(STORAGE_THEME_KEY, "system");
      updateThemeIcon();
      updateThemeColorMeta();
      return;
    }
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_THEME_KEY, theme);
    updateThemeIcon();
    updateThemeColorMeta();
  }

  function getEffectiveTheme() {
    const explicit = document.documentElement.getAttribute("data-theme");
    if (explicit) return explicit;
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  }

  function updateThemeIcon() {
    const eff = getEffectiveTheme();
    themeBtn.textContent = eff === "dark" ? "☀️" : "🌙";
  }

  function updateThemeColorMeta() {
    const eff = getEffectiveTheme();
    themeColorMeta?.setAttribute("content", eff === "dark" ? "#0b0c10" : "#f5f6fa");
  }

  // ---------- init state ----------
  function buildEmptyLogs(workout) {
    return workout.exercises.map(ex => {
      const rows = [];
      for (let i = 0; i < ex.sets; i++) rows.push({ weight: "", reps: "", rir: "" });
      return rows;
    });
  }

  function buildEmptyDone(workout) {
    return workout.exercises.map(ex => Array(ex.sets).fill(false));
  }

  function initWorkoutState(workoutId) {
    const w = getWorkoutById(workoutId);
    if (!w) return false;

    state.workoutId = workoutId;
    state.exIndex = 0;
    state.setIndex = 0;
    state.doneSets = buildEmptyDone(w);
    state.logs = buildEmptyLogs(w);
    state.startedAtISO = new Date().toISOString();
    state.finishedAtISO = null;
    state.isFinished = false;

    saveState();
    return true;
  }

  // ---------- timer ----------
  function stopTimer() {
    timer.running = false;
    timer.endAt = 0;
    timer.restSec = 0;
    if (timer.interval) clearInterval(timer.interval);
    timer.interval = null;
    timerBox.hidden = true;
  }

  function startRest(restSec) {
    if (!restSec || restSec <= 0) {
      advanceAfterSet();
      render();
      return;
    }

    stopTimer();
    timer.running = true;
    timer.restSec = restSec;
    timer.endAt = Date.now() + restSec * 1000;

    timerBox.hidden = false;
    tickTimer();
    timer.interval = setInterval(tickTimer, 200);
  }

  function tickTimer() {
    const left = Math.ceil((timer.endAt - Date.now()) / 1000);
    timerText.textContent = formatTime(left);
    if (left <= 0) {
      stopTimer();
      beep(); vibrate(250);
      advanceAfterSet();
      render();
    }
  }

  // ---------- flow ----------
  function clampState() {
    const w = getCurrentWorkout();
    if (!w) return;
    state.exIndex = Math.max(0, Math.min(state.exIndex, w.exercises.length - 1));
    const ex = getCurrentExercise();
    if (!ex) return;
    state.setIndex = Math.max(0, Math.min(state.setIndex, ex.sets - 1));
  }

  function advanceAfterSet() {
    const w = getCurrentWorkout();
    const ex = getCurrentExercise();
    if (!w || !ex) return;

    if (state.setIndex < ex.sets - 1) {
      state.setIndex += 1;
      saveState();
      return;
    }

    if (state.exIndex < w.exercises.length - 1) {
      state.exIndex += 1;
      state.setIndex = 0;
      saveState();
      return;
    }

    // finish workout
    state.isFinished = true;
    state.finishedAtISO = new Date().toISOString();
    saveState();
    showDone();
  }

  function showWorkout() {
    doneCard.hidden = true;
    exerciseCard.hidden = false;
    resetBtn.hidden = false;
    shareBtn.hidden = false;
  }

  function showDone() {
    stopTimer();
    exerciseCard.hidden = true;
    doneCard.hidden = false;
    resetBtn.hidden = true;
    shareBtn.hidden = false;
    renderSummary();
  }

  // ---------- set done ----------
  function isActiveSet(exIdx, setIdx) {
    return exIdx === state.exIndex && setIdx === state.setIndex;
  }

  function canCompleteCurrent() {
    return !timer.running && !state.isFinished;
  }

  function toggleSetDone(exIdx, setIdx) {
    if (timer.running) return;

    // only allow toggling inside current workout
    const w = getCurrentWorkout();
    if (!w) return;

    // switch active set when tapping tick on another row
    state.exIndex = exIdx;
    state.setIndex = setIdx;
    clampState();

    const done = state.doneSets[exIdx][setIdx] === true;

    if (done) {
      // undo
      state.doneSets[exIdx][setIdx] = false;
      saveState();
      render();
      return;
    }

    // mark done + rest
    state.doneSets[exIdx][setIdx] = true;
    saveState();

    const ex = getCurrentExercise();
    startRest(ex?.restSec || 0);
    render();
  }

  // ---------- render (workout) ----------
  function render() {
    const w = getCurrentWorkout();
    if (!w) return;

    if (state.isFinished) {
      showDone();
      return;
    }

    clampState();
    const ex = getCurrentExercise();
    if (!ex) return;

    showWorkout();

    workoutTitle.textContent = w.name;
    dateText.textContent = localDateLabel(state.startedAtISO);

    exTitle.textContent = ex.name;

    const tempoPart = ex.tempo ? `Tempo ${ex.tempo}` : "";
    const restPart = ex.restSec ? `Rest ${formatTime(ex.restSec)}` : "Rest —";
    exMeta.textContent = `${ex.sets} sets • Reps: ${ex.reps}${tempoPart ? " • " + tempoPart : ""} • ${restPart}`;

    exCounter.textContent = `Exercise ${state.exIndex + 1}/${w.exercises.length}`;

    setTbody.innerHTML = "";

    for (let i = 0; i < ex.sets; i++) {
      const tr = document.createElement("tr");

      const isActive = i === state.setIndex;
      const isDone = state.doneSets?.[state.exIndex]?.[i] === true;

      if (isActive) tr.classList.add("rowActive");
      if (isDone) tr.classList.add("rowDone");

      tr.addEventListener("click", (e) => {
        if (e.target?.tagName === "INPUT" || e.target?.tagName === "BUTTON") return;
        if (timer.running) return;
        state.setIndex = i;
        saveState();
        render();
      });

      // Set number
      const tdSet = document.createElement("td");
      tdSet.className = "setNum";
      tdSet.textContent = String(i + 1);
      tr.appendChild(tdSet);

      // Inputs
      tr.appendChild(makeInputCell("weight", state.exIndex, i, "kg", "decimal"));
      tr.appendChild(makeInputCell("reps", state.exIndex, i, "", "numeric"));
      tr.appendChild(makeInputCell("rir", state.exIndex, i, "", "numeric"));

      // Done tick
      const tdDone = document.createElement("td");
      tdDone.style.textAlign = "right";

      const btn = document.createElement("button");
      btn.className = "tickBtn";
      if (isActive) btn.classList.add("active");
      if (isDone) btn.classList.add("done");

      btn.textContent = isDone ? "✓" : "✓";
      btn.title = isDone ? "Undo" : "Done + Rest";
      btn.ariaLabel = isDone ? "Undo set" : "Complete set";

      // enable only for active set (clean flow)
      btn.disabled = timer.running || !isActive || state.isFinished;

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSetDone(state.exIndex, i);
      });

      tdDone.appendChild(btn);
      tr.appendChild(tdDone);

      setTbody.appendChild(tr);
    }

    saveState();
  }

  function makeInputCell(field, exIdx, setIdx, placeholder, inputMode) {
    const td = document.createElement("td");

    const input = document.createElement("input");
    input.className = "cellInput";
    input.type = "text";
    input.inputMode = inputMode || "decimal";
    input.autocomplete = "off";
    input.placeholder = placeholder;

    const val = state.logs?.[exIdx]?.[setIdx]?.[field] ?? "";
    input.value = val;

    input.addEventListener("input", () => {
      state.logs[exIdx][setIdx][field] = input.value;
      saveState();
    });

    input.addEventListener("click", (e) => e.stopPropagation());
    td.appendChild(input);
    return td;
  }

  // ---------- summary ----------
  function renderSummary() {
    const w = getCurrentWorkout() || getWorkoutById(state.workoutId);
    if (!w) return;

    const date = localDateLabel(state.startedAtISO);
    const dur = durationLabel(state.startedAtISO, state.finishedAtISO);
    doneMeta.textContent = `${w.name} • ${date} • Duration: ${dur}`;

    let overallReps = 0;
    let overallVolume = 0;
    let overallSets = 0;
    let doneSets = 0;

    // compute totals
    const perExercise = w.exercises.map((ex, exIdx) => {
      let exReps = 0;
      let exVol = 0;
      let exSets = ex.sets;
      let exDone = 0;

      const rows = [];
      for (let s = 0; s < ex.sets; s++) {
        const log = state.logs?.[exIdx]?.[s] || { weight: "", reps: "", rir: "" };
        const wNum = parseNum(log.weight);
        const rNum = parseNum(log.reps);
        const v = (isFinite(wNum) && isFinite(rNum)) ? (wNum * rNum) : 0;

        if (isFinite(rNum)) exReps += rNum;
        exVol += v;

        const isDone = state.doneSets?.[exIdx]?.[s] === true;
        if (isDone) exDone++;

        rows.push({
          set: s + 1,
          weight: log.weight || "",
          reps: log.reps || "",
          rir: log.rir || "",
          vol: v,
          done: isDone,
        });
      }

      overallReps += exReps;
      overallVolume += exVol;
      overallSets += exSets;
      doneSets += exDone;

      return {
        ex,
        exIdx,
        reps: exReps,
        volume: exVol,
        sets: exSets,
        done: exDone,
        rows,
      };
    });

    summaryTotals.innerHTML = `
      <div class="summaryGrid">
        <div class="kpi"><div class="k">Total Volume</div><div class="v">${Math.round(overallVolume)}</div></div>
        <div class="kpi"><div class="k">Total Reps</div><div class="v">${Math.round(overallReps)}</div></div>
        <div class="kpi"><div class="k">Sets Done</div><div class="v">${doneSets}/${overallSets}</div></div>
        <div class="kpi"><div class="k">Exercises</div><div class="v">${w.exercises.length}</div></div>
      </div>
    `;

    summaryWrap.innerHTML = "";
    for (const item of perExercise) {
      const exName = item.ex.name;
      const rest = item.ex.restSec ? formatTime(item.ex.restSec) : "—";
      const tempo = item.ex.tempo || "—";

      const card = document.createElement("div");
      card.className = "card";

      const rowsHtml = item.rows.map(r => `
        <tr>
          <td>${r.set}</td>
          <td>${escapeHtml(r.weight)}</td>
          <td>${escapeHtml(r.reps)}</td>
          <td>${escapeHtml(r.rir)}</td>
          <td>${Math.round(r.vol)}</td>
        </tr>
      `).join("");

      card.innerHTML = `
        <div class="exSummaryTitle">${escapeHtml(exName)}</div>
        <div class="meta">${item.ex.sets} sets • Reps target: ${escapeHtml(item.ex.reps)} • Tempo: ${escapeHtml(tempo)} • Rest: ${rest} • Done: ${item.done}/${item.sets}</div>
        <div class="meta">Exercise Volume: <b>${Math.round(item.volume)}</b> • Exercise Reps: <b>${Math.round(item.reps)}</b></div>

        <div class="tableWrap" style="margin-top:12px;">
          <table class="smallTable" aria-label="Exercise summary table">
            <thead>
              <tr>
                <th style="width:12%;">Set</th>
                <th style="width:28%;">Weight</th>
                <th style="width:18%;">Reps</th>
                <th style="width:18%;">RIR</th>
                <th style="width:24%;">Volume</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      `;

      summaryWrap.appendChild(card);
    }
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ---------- navigation ----------
  function goPrevExercise() {
    if (timer.running || state.isFinished) return;
    const w = getCurrentWorkout();
    if (!w) return;
    if (state.exIndex > 0) {
      state.exIndex -= 1;
      state.setIndex = 0;
      saveState();
      render();
    }
  }

  function goNextExercise() {
    if (timer.running || state.isFinished) return;
    const w = getCurrentWorkout();
    if (!w) return;
    if (state.exIndex < w.exercises.length - 1) {
      state.exIndex += 1;
      state.setIndex = 0;
      saveState();
      render();
    } else {
      // if user jumps to end without completing, still show summary of what's entered
      state.isFinished = true;
      state.finishedAtISO = new Date().toISOString();
      saveState();
      showDone();
    }
  }

  // ---------- UI ----------
  function populateSelect(defaultId) {
    workoutSelect.innerHTML = "";
    WORKOUTS.forEach(w => {
      const opt = document.createElement("option");
      opt.value = w.id;
      opt.textContent = w.name;
      workoutSelect.appendChild(opt);
    });
    workoutSelect.value = defaultId || WORKOUTS[0]?.id || "";
  }

  function startSelectedWorkout() {
    stopTimer();
    const id = workoutSelect.value;
    if (!id) return;

    initWorkoutState(id);
    setUrlWorkout(id);

    resumeBtn.hidden = true;
    resetBtn.hidden = false;
    shareBtn.hidden = false;

    render();
  }

  function resumeIfPossible() {
    const s = loadState();
    if (!s) return false;
    const w = getWorkoutById(s.workoutId);
    if (!w) return false;

    state = s;
    setUrlWorkout(state.workoutId);
    workoutSelect.value = state.workoutId;

    if (state.isFinished) showDone();
    else render();

    return true;
  }

  function resetWorkout() {
    stopTimer();
    clearState();
    initWorkoutState(workoutSelect.value);
    render();
    flash("Reset ✅");
  }

  // ---------- events ----------
  startBtn.addEventListener("click", startSelectedWorkout);
  resumeBtn.addEventListener("click", () => { resumeIfPossible(); resumeBtn.hidden = true; });
  resetBtn.addEventListener("click", resetWorkout);
  shareBtn.addEventListener("click", copyShareLink);

  prevBtn.addEventListener("click", goPrevExercise);
  nextBtn.addEventListener("click", goNextExercise);

  skipRestBtn.addEventListener("click", () => {
    stopTimer();
    advanceAfterSet();
    render();
  });

  stopTimerBtn.addEventListener("click", stopTimer);

  doneResetBtn.addEventListener("click", () => {
    doneCard.hidden = true;
    startSelectedWorkout();
  });

  workoutSelect.addEventListener("change", () => {
    setUrlWorkout(workoutSelect.value);
    const s = loadState();
    resumeBtn.hidden = !(s && s.workoutId === workoutSelect.value);
  });

  themeBtn.addEventListener("click", () => {
    const saved = localStorage.getItem(STORAGE_THEME_KEY) || "system";
    if (saved === "system") setTheme("dark");
    else if (saved === "dark") setTheme("light");
    else setTheme("system");
  });

  window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
    updateThemeIcon();
    updateThemeColorMeta();
  });

  // ---------- init ----------
  (function init() {
    // theme
    const savedTheme = localStorage.getItem(STORAGE_THEME_KEY) || "system";
    setTheme(savedTheme);

    const url = new URL(window.location.href);
    const wParam = url.searchParams.get("w");
    const defaultId = getWorkoutById(wParam)?.id || WORKOUTS[0]?.id;

    populateSelect(defaultId);
    setUrlWorkout(workoutSelect.value);

    const s = loadState();
    if (s && getWorkoutById(s.workoutId)) {
      resumeBtn.hidden = !(s.workoutId === workoutSelect.value);
      resetBtn.hidden = true;
      shareBtn.hidden = false;
    } else {
      resumeBtn.hidden = true;
      resetBtn.hidden = true;
      shareBtn.hidden = true;
    }

    updateThemeIcon();
    updateThemeColorMeta();
  })();
})();
