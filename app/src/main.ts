import { mountApp } from "./ui/app";

window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("app");
  if (root) mountApp(root);
});
