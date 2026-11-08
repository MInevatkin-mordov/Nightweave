// Общий переключатель темы: одна настройка на все страницы (localStorage).
(function () {
  var KEY = "nw-theme";
  var root = document.documentElement;
  function read() {
    try {
      var v = localStorage.getItem(KEY);
      if (v === "light" || v === "dark") return v;
    } catch (e) {}
    return "dark";
  }
  function paint(theme) {
    root.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#eef2f5" : "#0c141b");
    var buttons = document.querySelectorAll(".theme-switch button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", String(buttons[i].dataset.theme === theme));
    }
  }
  function set(theme) {
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    paint(theme);
  }
  // применяем сразу, до отрисовки, чтобы не мигало
  paint(read());

  function mount() {
    var header = document.querySelector(".header");
    if (header && !header.querySelector(".theme-switch")) {
      var box = document.createElement("div");
      box.className = "theme-switch";
      box.setAttribute("role", "group");
      box.setAttribute("aria-label", "Тема оформления");
      [["dark", "☾", "Тёмная"], ["light", "☀", "Светлая"]].forEach(function (t) {
        var b = document.createElement("button");
        b.type = "button";
        b.dataset.theme = t[0];
        b.title = t[2] + " тема";
        b.innerHTML = "<i aria-hidden=\"true\">" + t[1] + "</i><span>" + t[2] + "</span>";
        b.onclick = function () { set(t[0]); };
        box.appendChild(b);
      });
      header.appendChild(box);
    }
    paint(read());
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  // синхронизация между открытыми вкладками
  window.addEventListener("storage", function (e) { if (e.key === KEY) paint(read()); });
})();
