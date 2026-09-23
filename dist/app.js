const favicon = document.querySelector('link[rel="icon"]') || document.head.appendChild(document.createElement("link"));
favicon.rel = "icon";
favicon.type = "image/png";
favicon.href = "/assets/soryn-logo.png?v=2";

const style = document.createElement("link");
style.rel = "stylesheet";
style.href = "/v2.css";
document.head.append(style);

const enhancements = document.createElement("link");
enhancements.rel = "stylesheet";
enhancements.href = "/enhancements.css";
document.head.append(enhancements);

const depth = document.createElement("link");
depth.rel = "stylesheet";
depth.href = "/depth.css";
document.head.append(depth);

const loopInteraction = document.createElement('link');
loopInteraction.rel = 'stylesheet';
loopInteraction.href = '/loop-interaction.css';
document.head.append(loopInteraction);

const rawPanel = document.createElement('link');
rawPanel.rel = 'stylesheet';
rawPanel.href = '/raw-panel.css';
document.head.append(rawPanel);

import("/app-v2.js").then(() => import("/enhancements.js")).then(() => import("/depth.js"));
