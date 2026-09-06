(function () {
  try {
    var saved = localStorage.getItem("adci-theme");
    var theme = saved === "dark" || saved === "light"
      ? saved
      : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (_error) {
    document.documentElement.dataset.theme = "light";
  }
  document.addEventListener("contextmenu", function (event) { event.preventDefault(); });
})();
