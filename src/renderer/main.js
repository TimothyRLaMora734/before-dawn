import Vue from "vue";
import VueElectron from "vue-electron";
import BootstrapVue from "bootstrap-vue";

import Prefs from "./Prefs";
import Settings from "./Settings";
import Editor from "./Editor";
import NewScreensaver from "./NewScreensaver";
import About from "./About";

import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-vue/dist/bootstrap-vue.css";
import "../css/styles.scss";


if (!process.env.IS_WEB) {
  Vue.use(require("vue-electron"));
}
Vue.config.productionTip = false;

Vue.use(VueElectron);
Vue.use(BootstrapVue);

var actions = {
  "prefs": { components: { Prefs }, template: "<Prefs/>" },
  "settings": { components: { Settings }, template: "<Settings/>" },
  "editor": { components: { Editor }, template: "<Editor/>" },
  "new": { components: { NewScreensaver }, template: "<NewScreensaver/>" },
  "about": { components: { About }, template: "<About/>" }
};

var id = document.querySelector("body > div").id;
var opts = actions[id];

new Vue(opts).$mount("#" + id);
