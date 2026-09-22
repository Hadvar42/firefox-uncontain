"use strict";
const D = {
  mode: "preempt",
  keepOriginalTab: true,
  hostAllowlist: [],
  onlyWhenSiteDiffers: true,
  newTabGraceMs: 2000,
  startupGraceMs: 20000,
};
const $ = (id) => document.getElementById(id);

browser.storage.local.get("cfg").then(({ cfg }) => {
  const c = { ...D, ...(cfg || {}) };
  $("mode").value = c.mode;
  $("keepOriginalTab").checked = c.keepOriginalTab;
  $("onlyWhenSiteDiffers").checked = c.onlyWhenSiteDiffers;
  $("hostAllowlist").value = c.hostAllowlist.join("\n");
  $("newTabGraceMs").value = c.newTabGraceMs;
  $("startupGraceMs").value = c.startupGraceMs;
});

$("save").addEventListener("click", async () => {
  const cfg = {
    mode: $("mode").value,
    keepOriginalTab: $("keepOriginalTab").checked,
    onlyWhenSiteDiffers: $("onlyWhenSiteDiffers").checked,
    hostAllowlist: $("hostAllowlist").value.split(/\s+/).map((s) => s.trim()).filter(Boolean),
    newTabGraceMs: Number($("newTabGraceMs").value) || 0,
    startupGraceMs: Number($("startupGraceMs").value) || 0,
  };
  await browser.storage.local.set({ cfg });
  $("saved").textContent = "saved";
  setTimeout(() => ($("saved").textContent = ""), 1500);
});
