import DefaultTheme from "vitepress/theme";
import "@nikodellic/publisher-docs/style.css";
import "./style.css";
import { onMounted, nextTick } from "vue";
export default {
  extends: DefaultTheme,
  setup() {
    onMounted(async () => {
      if (new URLSearchParams(location.search).get("search") !== "1") return;
      await nextTick();
      const openSearch = () => {
        const button = document.querySelector<HTMLButtonElement>(
          ".VPNavBarSearch button",
        );
        if (!button) return false;
        button.click();
        return true;
      };
      if (!openSearch()) {
        const observer = new MutationObserver(() => {
          if (openSearch()) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 10000);
      }
      const url = new URL(location.href);
      url.searchParams.delete("search");
      history.replaceState(history.state, "", url);
    });
  },
};
