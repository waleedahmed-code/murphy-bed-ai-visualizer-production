/* Island Murphy Beds — complete builder controller
 * Correct builder script for murphy-bed-builder.liquid.
 * Supports normal storefront loading and Shopify Theme Editor section reloads.
 */

function initMurphyBuilderCore(scope) {
  const searchRoot = scope || document;
  const builderRoot = searchRoot.matches?.("[data-imb-guided-builder]")
    ? searchRoot
    : searchRoot.querySelector?.("[data-imb-guided-builder]") ||
      document.querySelector("[data-imb-guided-builder]");

  if (!builderRoot) return;
  if (builderRoot.dataset.builderCoreInitialized === "true") return;
  builderRoot.dataset.builderCoreInitialized = "true";

const ENDPOINT =
  "https://island-draft-order-checkout-vercel.vercel.app/api/create-draft-order";
    const BM_LINK = "https://www.benjaminmoore.com/en-us/paint-colors/search";
  const STAIN_SOURCE = "Island Murphy Beds Stain Library";

  function num(v) {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  function getChecked(selector) {
    return builderRoot.querySelector(`${selector}:checked`);
  }

  function slugifyStainKey(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  const previewStage = document.getElementById("preview-stage");
  const previewBase = document.getElementById("preview-base");
  const overlayDoor = document.getElementById("overlay-door");
  const overlayCrown = document.getElementById("overlay-crown");
  const overlayCabinetLeft = document.getElementById("overlay-cabinet-left");
  const overlayCabinetRight = document.getElementById("overlay-cabinet-right");
  const overlayTrayLeft = document.getElementById("overlay-tray-left");
  const overlayTrayRight = document.getElementById("overlay-tray-right");
  const overlayUpperLeft = document.getElementById("overlay-upper-left");
  const overlayUpperRight = document.getElementById("overlay-upper-right");
  const overlayDrawersLeft = document.getElementById("overlay-drawers-left");
  const overlayDrawersRight = document.getElementById("overlay-drawers-right");
  const overlayLowerLeft = document.getElementById("overlay-lower-left");
  const overlayLowerRight = document.getElementById("overlay-lower-right");

  const lowerDoorAssets = document.querySelector(".lower-door-assets");
  const trayAssets = document.querySelector(".tray-assets");
  const hiddenLeftCabinet = document.querySelector(".cabinet-option:not(.second)");
  const hiddenRightCabinet = document.querySelector(".cabinet-option.second");

  const basePriceEl = document.getElementById("base-price");
  const addonsPriceEl = document.getElementById("addons-price");
  const totalPriceEl = document.getElementById("total-price");
  const depositFullOrderTotalEl = document.getElementById("deposit-full-order-total");
  const depositDueTodayEl = document.getElementById("deposit-due-today");
  const depositRemainingEl = document.getElementById("deposit-remaining");

  const sizeField = document.getElementById("size-field");
  const doorField = document.getElementById("door-field");
  const crownField = document.getElementById("crown-field");
  const leftSideField = document.getElementById("left-side-field");
  const rightSideField = document.getElementById("right-side-field");
  const finishField = document.getElementById("finish-field");
  const colorField = document.getElementById("color-field");
  const mattressField = document.getElementById("mattress-field");
  const lightsField = document.getElementById("lights-field");
  const faceFrameField = document.getElementById("face-frame-field");
  const addonsField = document.getElementById("addons-field");
  const totalPriceField = document.getElementById("total-price-field");

  const paintColorNameField = document.getElementById("paint-color-name-field");
  const paintColorCodeField = document.getElementById("paint-color-code-field");
  const paintSourceField = document.getElementById("paint-source-field");

  const stainColorNameField = document.getElementById("stain-color-name-field");
  const stainColorCodeField = document.getElementById("stain-color-code-field");
  const stainSourceField = document.getElementById("stain-source-field");

  const sizeRadios = document.querySelectorAll('.size-option input[type="radio"]');
  const doorCards = document.querySelectorAll(".door-option");
  const crownRadios = document.querySelectorAll('.crown-option input[type="radio"]');
  const mattressRadios = document.querySelectorAll('.mattress-options input[type="radio"]');
  const lightsCheckbox = document.getElementById("lights");

  const stainCards = document.querySelectorAll(".stain-card");
  const paintCheckbox = document.getElementById("paintCheckbox");
  const bmPicker = document.getElementById("bmPaintPicker");
  const bmPresetRadios = bmPicker ? bmPicker.querySelectorAll('input[name="bm-color"]') : [];

  const leftToggle = document.querySelector('.side-enable[data-side="left"]');
  const rightToggle = document.querySelector('.side-enable[data-side="right"]');
  const leftAddonsBox = document.querySelector(".side-addons.left");
  const rightAddonsBox = document.querySelector(".side-addons.right");
  const leftDrawerGroup = document.querySelector(".drawer-style-group.left");
  const rightDrawerGroup = document.querySelector(".drawer-style-group.right");
  const leftUpperGroup = document.querySelector(".upper-style-group.left");
  const rightUpperGroup = document.querySelector(".upper-style-group.right");
  const bothWideCheckbox = document.getElementById("make-both-wide");
  const faceFrameCheckbox = document.getElementById("face-frame-construction");

  const progressFill = document.getElementById("progress-fill");
  const progressTotal = document.getElementById("progress-total");

  const statusSize = document.getElementById("status-size");
  const statusDoor = document.getElementById("status-door");
  const statusFinish = document.getElementById("status-finish");

  const paintPriceEl = document.getElementById("paintPrice");
  const paintBasePriceEl = document.getElementById("paintBasePrice");
  const paintAddAmountEl = document.getElementById("paintAddAmount");
  const paintTotalEl = document.getElementById("paintTotal");

  const resetButton = document.getElementById("preview-reset");
  const steps = document.querySelectorAll(".builder-step");
  const form = document.getElementById("murphy-form");

  let STAIN_PREVIEW_MAP = {};
  try {
    const stainMapScript = document.getElementById("stain-preview-map");
    STAIN_PREVIEW_MAP = stainMapScript ? JSON.parse(stainMapScript.textContent.trim() || "{}") : {};
  } catch (error) {
    console.warn("Invalid stain preview JSON", error);
    STAIN_PREVIEW_MAP = {};
  }

  const state = {
    size: "",
    sizePrice: 0,
    doorName: "",
    doorUpcharge: 0,
    crownName: "",
    crownPrice: 0,
    leftEnabled: false,
    rightEnabled: false,
    leftBase: 895,
    rightBase: 895,
    bothWide: false,
    sideWidePrice: 200,
    faceFrameConstruction: false,
    faceFramePrice: 1000,
    leftAddons: {},
    rightAddons: {},
    stainName: "",
    stainKey: "",
    stainHex: "",
    finish: "",
    paintPreset: "",
    paintCode: "",
    mattressName: "",
    mattressPrice: 0,
    lights: false,
    lightsPrice: 350
  };

  const imagePromiseCache = new Map();
  const imageReadyCache = new Set();
  let previewRenderVersion = 0;

  function getSelectedDoorCard() {
    return document.querySelector(".door-option.selected") || null;
  }

  function getSelectedStainCard() {
    return document.querySelector(".stain-card.is-selected") || null;
  }

  function getSelectedStainKey() {
    const card = getSelectedStainCard();
    if (!card) return "";
    return card.dataset.key || slugifyStainKey(card.dataset.name || "");
  }

  function getDrawerStyleEl(side) {
    return getChecked(`.drawer-style-group.${side} input[type="radio"]`);
  }

  function getUpperStyleEl(side) {
    return getChecked(`.upper-style-group.${side} input[type="radio"]`);
  }

  function getStainAsset(...parts) {
    const key = getSelectedStainKey();
    const stainData =
      STAIN_PREVIEW_MAP[state.stainName] ||
      STAIN_PREVIEW_MAP[key] ||
      {};
    return stainData[parts.join("|")] || "";
  }

  function normalizePreviewAsset(value) {
    const src = String(value || "").trim();

    if (!src) return "";
    if (/^PASTE_/i.test(src)) return "";
    if (/admin\.shopify\.com\/store\//i.test(src)) return "";
    if (/^(undefined|null)$/i.test(src)) return "";

    if (
      !/^https?:\/\//i.test(src) &&
      !/^\/\//.test(src) &&
      !/^data:image\//i.test(src)
    ) {
      return "";
    }

    return src;
  }

  function getDefaultPreviewAsset(el, baseAttr) {
    if (!el) return "";

    return normalizePreviewAsset(
      el.getAttribute(`${baseAttr}-default`) ||
      el.getAttribute(baseAttr) ||
      ""
    );
  }

  function getInlineStainPreviewAsset(el, baseAttr) {
    if (!el) return "";

    const stainKey = getSelectedStainKey();
    if (!stainKey) return "";

    return normalizePreviewAsset(
      el.getAttribute(`${baseAttr}-${stainKey}`) || ""
    );
  }

  function getPreviewAsset(el, baseAttr, legacyParts = []) {
    const fallback = getDefaultPreviewAsset(el, baseAttr);

    if (state.finish === "Paint") {
      return fallback;
    }

    return (
      getInlineStainPreviewAsset(el, baseAttr) ||
      normalizePreviewAsset(getStainAsset(...legacyParts)) ||
      fallback
    );
  }

  function getPreviewAssetChoice(el, baseAttrs = []) {
    if (!el) return { src: "", baseAttr: "" };

    for (const baseAttr of baseAttrs) {
      if (!baseAttr) continue;

      const src = getPreviewAsset(el, baseAttr, []);
      if (src) {
        return { src, baseAttr };
      }
    }

    return { src: "", baseAttr: "" };
  }

  function getPreviewAssetWithFallbacks(el, baseAttrs = []) {
    return getPreviewAssetChoice(el, baseAttrs).src;
  }

  function isWideSide(side) {
    if (state.bothWide) {
      if (side === "left") return !!state.leftEnabled;
      if (side === "right") return !!state.rightEnabled;
    }

    if (side === "left") {
      return !!state.leftAddons['Left: Make 22" Wide'];
    }
    if (side === "right") {
      return !!state.rightAddons['Right: Make 22" Wide'];
    }
    return false;
  }

  function getUpperDoorPrice(side) {
    return isWideSide(side) ? 225 : 175;
  }

  function updateUpperDoorPriceLabels() {
    ["left", "right"].forEach((side) => {
      const upperDoorInput = document.querySelector(
        `.toggle-upper[data-side="${side}"]`
      );

      if (!upperDoorInput) return;

      const price = getUpperDoorPrice(side);
      upperDoorInput.dataset.price = String(price);

      const label = upperDoorInput.closest("label");
      let optionText = label?.querySelector(".option-text");

      if (!optionText && label) {
        optionText = document.createElement("span");
        optionText.className = "option-text";
        label.appendChild(optionText);
      }

      if (optionText) {
        optionText.textContent = `Add Upper Door (+$${price})`;
      }
    });
  }

  function getCrownPlacementKey() {
    const leftOn = state.leftEnabled;
    const rightOn = state.rightEnabled;
    const leftWide = isWideSide("left");
    const rightWide = isWideSide("right");

    if (leftOn && rightOn) {
      return (leftWide || rightWide) ? "full-wide" : "full";
    }

    if (leftOn) {
      return leftWide ? "left-wide" : "left";
    }

    if (rightOn) {
      return rightWide ? "right-wide" : "right";
    }

    return "door";
  }

  function showBmPicker(show) {
    if (!bmPicker) return;
    bmPicker.style.display = show ? "block" : "none";
  }

  function pulsePreview() {
    if (!previewStage) return;
    previewStage.classList.remove("is-refreshing");
    previewStage.classList.remove("is-updating");
    void previewStage.offsetWidth;
    previewStage.classList.add("is-refreshing");
    previewStage.classList.add("is-updating");

    window.clearTimeout(pulsePreview._timer);
    pulsePreview._timer = window.setTimeout(() => {
      previewStage.classList.remove("is-updating");
    }, 320);

    if (window.gsap) {
      window.gsap.fromTo(
        previewStage,
        { rotateX: 0.8, rotateY: -0.5, scale: 0.996, transformPerspective: 1200 },
        { rotateX: 0, rotateY: 0, scale: 1, duration: 0.34, ease: "power2.out" }
      );
    }
  }

  function setActiveStep(stepNo) {
    steps.forEach((step) => {
      step.classList.toggle("is-active", step.dataset.step === String(stepNo));
    });
  }

  function mapSideAddons(side) {
    const data = {};
    document.querySelectorAll(`.side-addon[data-side="${side}"]`).forEach((input) => {
      data[input.dataset.name] = !!input.checked;
    });
    return data;
  }

  function ensureFirstChecked(groupEl) {
    if (!groupEl) return;
    const anyChecked = groupEl.querySelector('input[type="radio"]:checked');
    if (anyChecked) return;
    const first = groupEl.querySelector('input[type="radio"]');
    if (first) first.checked = true;
  }

  function clearCustomSelections() {
    const chooseRadio = (nodes, preferredValue) => {
      const list = Array.from(nodes || []);
      if (!list.length) return;

      const preferred =
        list.find((input) => String(input.value || "") === String(preferredValue || "")) ||
        list[0];

      list.forEach((input) => {
        input.checked = input === preferred;
      });
    };

    chooseRadio(sizeRadios, "Single");
    chooseRadio(crownRadios, "No Crown");
    chooseRadio(mattressRadios, "Siesta Mattress");

    chooseRadio(
      builderRoot.querySelectorAll('input[name="left-drawer-style"]'),
      "Flat Drawer"
    );
    chooseRadio(
      builderRoot.querySelectorAll('input[name="right-drawer-style"]'),
      "Flat Drawer"
    );
    chooseRadio(
      builderRoot.querySelectorAll('input[name="left-upper-style"]'),
      "Left Upper: Plain"
    );
    chooseRadio(
      builderRoot.querySelectorAll('input[name="right-upper-style"]'),
      "Right Upper: Plain"
    );

    bmPresetRadios.forEach((input) => {
      input.checked = false;
    });

    if (paintCheckbox) paintCheckbox.checked = false;
    if (lightsCheckbox) lightsCheckbox.checked = false;
    if (leftToggle) leftToggle.checked = false;
    if (rightToggle) rightToggle.checked = false;
    if (bothWideCheckbox) bothWideCheckbox.checked = false;
    if (faceFrameCheckbox) faceFrameCheckbox.checked = false;

    builderRoot.querySelectorAll(".side-addon").forEach((input) => {
      input.checked = false;
    });

    doorCards.forEach((card) => {
      card.classList.remove("selected");
      delete card.dataset.preventReselectUntil;
    });

    const defaultDoorCard =
      Array.from(doorCards).find(
        (card) => String(card.dataset.value || "").trim() === "Flat Modern"
      ) ||
      doorCards[0];

    if (defaultDoorCard) {
      defaultDoorCard.classList.add("selected");
    }

    stainCards.forEach((card) => {
      card.classList.remove("is-selected");
      delete card.dataset.preventReselectUntil;
    });

    const defaultStainCard =
      Array.from(stainCards).find(
        (card) =>
          String(card.dataset.key || "") === "light-walnut" ||
          String(card.dataset.name || "") === "Light Walnut"
      ) ||
      stainCards[0];

    if (defaultStainCard) {
      defaultStainCard.classList.add("is-selected");
    }

    builderRoot
      .querySelectorAll(
        ".size-option, .crown-option, .mattress-options label, .lights-option, .side-toggle, .side-addons > label, .side-wide-card, .drawer-style, .upper-style, .bm-option"
      )
      .forEach((el) => {
        el.classList.remove("is-selected");
        delete el.dataset.preventReselectUntil;
        delete el.dataset.wasChecked;
      });

    if (leftAddonsBox) leftAddonsBox.style.display = "none";
    if (rightAddonsBox) rightAddonsBox.style.display = "none";
    if (leftDrawerGroup) leftDrawerGroup.style.display = "none";
    if (rightDrawerGroup) rightDrawerGroup.style.display = "none";
    if (leftUpperGroup) leftUpperGroup.style.display = "none";
    if (rightUpperGroup) rightUpperGroup.style.display = "none";

    showBmPicker(false);
  }

  function hydrateStateFromDOM() {
    const size = getChecked('.size-option input[type="radio"]');
    const door = getSelectedDoorCard();
    const crown = getChecked('.crown-option input[type="radio"]');
    const mattress = getChecked('.mattress-options input[type="radio"]');
    const selectedStain = getSelectedStainCard();
    const selectedPaint = getChecked("#bmPaintPicker input[name='bm-color']");

    state.size = size ? size.value : "";
    state.sizePrice = size ? num(size.dataset.price) : 0;

    state.doorName = door ? door.dataset.value : "";
    state.doorUpcharge = door ? num(door.dataset.price) : 0;

    state.crownName = crown ? crown.value : "";
    state.crownPrice = crown ? num(crown.dataset.price) : 0;

    state.leftEnabled = !!leftToggle?.checked;
    state.rightEnabled = !!rightToggle?.checked;
    state.leftBase = num(leftToggle?.dataset.base || 895);
    state.rightBase = num(rightToggle?.dataset.base || 895);
    state.bothWide = !!bothWideCheckbox?.checked;
    state.sideWidePrice = num(
      bothWideCheckbox?.dataset.price ||
      bothWideCheckbox?.dataset.pricePerSide ||
      200
    );
    state.faceFrameConstruction = !!faceFrameCheckbox?.checked;
    state.faceFramePrice = num(faceFrameCheckbox?.dataset.price || 1000);

    state.leftAddons = mapSideAddons("left");
    state.rightAddons = mapSideAddons("right");

    state.stainName = selectedStain ? selectedStain.dataset.name || "" : "";
    state.stainKey = selectedStain ? (selectedStain.dataset.key || slugifyStainKey(selectedStain.dataset.name || "")) : "";
    state.stainHex = selectedStain ? selectedStain.dataset.hex || "" : "";

    state.finish = paintCheckbox?.checked ? "Paint" : (selectedStain ? "Stained and Lacquer" : "");
    state.paintPreset = selectedPaint ? selectedPaint.value : "";
    state.paintCode = selectedPaint ? selectedPaint.dataset.code || "" : "";

    state.mattressName = mattress ? mattress.value : "";
    state.mattressPrice = mattress ? num(mattress.dataset.price) : 0;

    state.lights = !!lightsCheckbox?.checked;
    state.lightsPrice = num(lightsCheckbox?.dataset.price || 350);
  }

  function syncSelectableClasses() {
    const selectors = [
      ".size-option",
      ".crown-option",
      ".mattress-options label",
      ".lights-option",
      ".side-toggle",
      ".side-addons > label",
      ".side-wide-card",
      ".drawer-style",
      ".upper-style",
      ".bm-option"
    ];

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        const input = el.querySelector("input");
        el.classList.toggle("is-selected", !!input?.checked);
      });
    });
  }

  function getLowerDoorVariant() {
    const doorName = (state.doorName || "").toLowerCase();
    if (doorName.includes("shaker") || doorName.includes("rockland") || doorName.includes("douglas")) return "shaker";
    return "flat";
  }

  function preloadImage(url) {
    if (!url) return Promise.resolve("");

    if (imagePromiseCache.has(url)) {
      return imagePromiseCache.get(url);
    }

    const promise = new Promise((resolve) => {
      const img = new Image();

      const done = () => {
        const finalize = () => {
          imageReadyCache.add(url);
          resolve(url);
        };

        if (typeof img.decode === "function") {
          img.decode().then(finalize).catch(finalize);
        } else {
          finalize();
        }
      };

      img.onload = done;
      img.onerror = () => resolve("");
      img.src = url;

      if (img.complete) {
        done();
      }
    });

    imagePromiseCache.set(url, promise);
    return promise;
  }

  function preloadImages(urls, concurrency = 5) {
    const uniqueUrls = [...new Set((urls || []).map(normalizePreviewAsset).filter(Boolean))];
    if (!uniqueUrls.length) return Promise.resolve([]);

    let nextIndex = 0;
    const results = [];

    const worker = async () => {
      while (nextIndex < uniqueUrls.length) {
        const index = nextIndex++;
        results[index] = await preloadImage(uniqueUrls[index]);
      }
    };

    const workers = Array.from(
      { length: Math.min(Math.max(1, concurrency), uniqueUrls.length) },
      () => worker()
    );

    return Promise.all(workers).then(() => results);
  }

  function collectDataAttributeUrls(root) {
    const urls = [];
    if (!root || !root.attributes) return urls;

    Array.from(root.attributes).forEach((attr) => {
      const name = attr.name || "";
      const value = attr.value || "";
      if (!name.startsWith("data-")) return;
      if (!value) return;
      if (/^https?:\/\//i.test(value)) {
        urls.push(value);
      }
    });

    return urls;
  }

  function collectCurrentFinishUrls(root, stainKey = getSelectedStainKey()) {
    const urls = [];
    if (!root || !root.attributes) return urls;

    const selectedSuffix = stainKey ? `-${stainKey}` : "";

    Array.from(root.attributes).forEach((attr) => {
      const name = String(attr.name || "");
      const value = normalizePreviewAsset(attr.value || "");
      if (!value) return;

      if (
        name === "src" ||
        name.endsWith("-default") ||
        (selectedSuffix && name.endsWith(selectedSuffix))
      ) {
        urls.push(value);
      }
    });

    return urls;
  }

  function getPreviewAssetSources() {
    return [
      previewBase,
      ...doorCards,
      ...crownRadios,
      hiddenLeftCabinet,
      hiddenRightCabinet,
      lowerDoorAssets,
      trayAssets,
      ...builderRoot.querySelectorAll('input[name="left-drawer-style"]'),
      ...builderRoot.querySelectorAll('input[name="right-drawer-style"]'),
      ...builderRoot.querySelectorAll('input[name="left-upper-style"]'),
      ...builderRoot.querySelectorAll('input[name="right-upper-style"]')
    ].filter(Boolean);
  }

  function warmPreloadCurrentFinishAssets() {
    const urls = [];
    const plan = buildPreviewPlan();

    Object.values(plan).forEach((item) => {
      if (item?.src) urls.push(item.src);
    });

    getPreviewAssetSources().forEach((source) => {
      urls.push(...collectCurrentFinishUrls(source));
    });

    const run = () => preloadImages(urls, 5);

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(run, { timeout: 900 });
    } else {
      window.setTimeout(run, 80);
    }
  }

  function bindPreviewIntentPreloading() {
    const selector =
      ".door-option, .crown-option, .stain-card, .side-toggle, .side-addons label, .side-wide-card, .drawer-style, .upper-style, .bm-option";

    const preloadTarget = (target) => {
      const choice = target?.closest?.(selector);
      if (!choice) return;

      const stainKey = choice.classList.contains("stain-card")
        ? choice.dataset.key || slugifyStainKey(choice.dataset.name || "")
        : getSelectedStainKey();

      const cacheKey = stainKey || "default";
      if (choice.dataset.preloadedFinish === cacheKey) return;
      choice.dataset.preloadedFinish = cacheKey;

      const urls = [];

      if (choice.classList.contains("stain-card")) {
        getPreviewAssetSources().forEach((source) => {
          urls.push(...collectCurrentFinishUrls(source, stainKey));
        });
      } else {
        const source = choice.matches("input") ? choice : choice.querySelector("input") || choice;
        urls.push(...collectCurrentFinishUrls(source, stainKey));
      }

      preloadImages(urls, 4);
    };

    builderRoot.addEventListener("pointerover", (event) => preloadTarget(event.target), {
      passive: true
    });
    builderRoot.addEventListener("focusin", (event) => preloadTarget(event.target));
    builderRoot.addEventListener("touchstart", (event) => preloadTarget(event.target), {
      passive: true
    });
  }

  function buildPreviewPlan() {
    const selectedDoor = getSelectedDoorCard();
    const crown = getChecked('.crown-option input[type="radio"]');
    const crownPlacementKey = getCrownPlacementKey();
    const lowerDoorVariant = getLowerDoorVariant();

    const leftDrawerStyleEl = getDrawerStyleEl("left");
    const rightDrawerStyleEl = getDrawerStyleEl("right");
    const leftUpperStyleEl = getUpperStyleEl("left");
    const rightUpperStyleEl = getUpperStyleEl("right");

    const leftWide = isWideSide("left");
    const rightWide = isWideSide("right");

    const plan = {
      base: { el: previewBase, src: "", show: true, mirrorX: false },
      door: { el: overlayDoor, src: "", show: false, mirrorX: false },
      crown: { el: overlayCrown, src: "", show: false, mirrorX: false },
      cabinetLeft: { el: overlayCabinetLeft, src: "", show: false, mirrorX: false },
      cabinetRight: { el: overlayCabinetRight, src: "", show: false, mirrorX: false },
      trayLeft: { el: overlayTrayLeft, src: "", show: false, mirrorX: false },
      trayRight: { el: overlayTrayRight, src: "", show: false, mirrorX: false },
      lowerLeft: { el: overlayLowerLeft, src: "", show: false, mirrorX: false },
      lowerRight: { el: overlayLowerRight, src: "", show: false, mirrorX: false },
      drawersLeft: { el: overlayDrawersLeft, src: "", show: false, mirrorX: false },
      drawersRight: { el: overlayDrawersRight, src: "", show: false, mirrorX: false },
      upperLeft: { el: overlayUpperLeft, src: "", show: false, mirrorX: false },
      upperRight: { el: overlayUpperRight, src: "", show: false, mirrorX: false }
    };

    const baseSrc = getPreviewAsset(previewBase, "data-image", ["base", "bed"]);
    plan.base.src = baseSrc || previewBase?.getAttribute("src") || "";
    plan.base.show = !!plan.base.src;

    if (state.doorName) {
      const doorSrc = getPreviewAsset(selectedDoor, "data-image", ["door", state.doorName]);
      plan.door.src = doorSrc;
      plan.door.show = !!doorSrc;
    }

    if (crown && state.crownName && state.crownName !== "No Crown") {
      const crownBasesByPlacement = {
        door: ["data-door"],
        "door-wide": ["data-door-wide", "data-door"],
        left: ["data-left"],
        "left-wide": ["data-left-wide", "data-left"],
        right: ["data-right"],
        "right-wide": ["data-right-wide", "data-right"],
        full: ["data-full"],
        "full-wide": ["data-full-wide", "data-full"]
      };

      const crownBases = crownBasesByPlacement[crownPlacementKey] || ["data-door"];
      const crownSrc = getPreviewAssetWithFallbacks(crown, crownBases);

      plan.crown.src = crownSrc;
      plan.crown.show = !!crownSrc;
    }

    if (state.leftEnabled) {
      const hasLeftDrawers = !!state.leftAddons["Left: Add Two Drawers"];

      const leftCabBases = leftWide
        ? ["data-left-wide", "data-left"]
        : ["data-left"];

      const leftCabSrc = getPreviewAssetWithFallbacks(
        hiddenLeftCabinet,
        leftCabBases
      );

      /*
       * Use the actual left 22-inch lower-door asset first.
       * Only use the right-wide canvas as a mirrored fallback when the
       * corresponding left-wide URL is missing or invalid.
       */
      const leftLowerBases = leftWide
        ? [
            `data-left-${lowerDoorVariant}-wide`,
            `data-left-${lowerDoorVariant}`,
            `data-right-${lowerDoorVariant}-wide`
          ]
        : [`data-left-${lowerDoorVariant}`];

      const leftLowerChoice = getPreviewAssetChoice(
        lowerDoorAssets,
        leftLowerBases
      );

      plan.cabinetLeft.src = leftCabSrc;
      plan.cabinetLeft.show = !!leftCabSrc;

      plan.lowerLeft.src = leftLowerChoice.src;
      plan.lowerLeft.show = !hasLeftDrawers && !!leftLowerChoice.src;
      plan.lowerLeft.mirrorX =
        leftWide &&
        leftLowerChoice.baseAttr.startsWith("data-right-");

      if (state.leftAddons["Left: Pull-Out Tray"]) {
        const leftTrayBases = leftWide
          ? ["data-left-wide", "data-left"]
          : ["data-left"];

        const leftTraySrc = getPreviewAssetWithFallbacks(
          trayAssets,
          leftTrayBases
        );

        plan.trayLeft.src = leftTraySrc;
        plan.trayLeft.show = !!leftTraySrc;
      }

      if (hasLeftDrawers) {
        let leftDrawerChoice = { src: "", baseAttr: "", mirrorX: false };

        if (leftWide) {
          const leftWideChoice = getPreviewAssetChoice(
            leftDrawerStyleEl,
            ["data-left-wide", "data-left"]
          );

          if (leftWideChoice.src) {
            leftDrawerChoice = {
              ...leftWideChoice,
              mirrorX: false
            };
          } else {
            const matchingRightDrawer = Array.from(
              builderRoot.querySelectorAll('input[name="right-drawer-style"]')
            ).find(
              (input) =>
                String(input.value || "") === String(leftDrawerStyleEl?.value || "")
            );

            const rightWideChoice = getPreviewAssetChoice(
              matchingRightDrawer,
              ["data-right-wide"]
            );

            leftDrawerChoice = {
              ...rightWideChoice,
              mirrorX: !!rightWideChoice.src
            };
          }
        } else {
          const standardChoice = getPreviewAssetChoice(
            leftDrawerStyleEl,
            ["data-left"]
          );

          leftDrawerChoice = {
            ...standardChoice,
            mirrorX: false
          };
        }

        plan.drawersLeft.src = leftDrawerChoice.src;
        plan.drawersLeft.show = !!leftDrawerChoice.src;
        plan.drawersLeft.mirrorX = !!leftDrawerChoice.mirrorX;
      }

      if (state.leftAddons["Left: Add Upper Door"]) {
        const leftUpperBases = leftWide
          ? ["data-left-wide", "data-left"]
          : ["data-left"];

        const leftUpperSrc = getPreviewAssetWithFallbacks(
          leftUpperStyleEl,
          leftUpperBases
        );

        plan.upperLeft.src = leftUpperSrc;
        plan.upperLeft.show = !!leftUpperSrc;
      }
    }

    if (state.rightEnabled) {
      const hasRightDrawers = !!state.rightAddons["Right: Add Two Drawers"];

      const rightCabBases = rightWide
        ? ["data-right-wide", "data-right"]
        : ["data-right"];

      const rightCabSrc = getPreviewAssetWithFallbacks(
        hiddenRightCabinet,
        rightCabBases
      );

      const rightLowerBases = rightWide
        ? [
            `data-right-${lowerDoorVariant}-wide`,
            `data-right-${lowerDoorVariant}`
          ]
        : [`data-right-${lowerDoorVariant}`];

      const rightLowerSrc = getPreviewAssetWithFallbacks(
        lowerDoorAssets,
        rightLowerBases
      );

      plan.cabinetRight.src = rightCabSrc;
      plan.cabinetRight.show = !!rightCabSrc;

      plan.lowerRight.src = rightLowerSrc;
      plan.lowerRight.show = !hasRightDrawers && !!rightLowerSrc;

      if (state.rightAddons["Right: Pull-Out Tray"]) {
        const rightTrayBases = rightWide
          ? ["data-right-wide", "data-right"]
          : ["data-right"];

        const rightTraySrc = getPreviewAssetWithFallbacks(
          trayAssets,
          rightTrayBases
        );

        plan.trayRight.src = rightTraySrc;
        plan.trayRight.show = !!rightTraySrc;
      }

      if (hasRightDrawers) {
        const rightDrawerBases = rightWide
          ? ["data-right-wide", "data-right"]
          : ["data-right"];

        const rightDrawerSrc = getPreviewAssetWithFallbacks(
          rightDrawerStyleEl,
          rightDrawerBases
        );

        plan.drawersRight.src = rightDrawerSrc;
        plan.drawersRight.show = !!rightDrawerSrc;
      }

      if (state.rightAddons["Right: Add Upper Doors"]) {
        const rightUpperBases = rightWide
          ? ["data-right-wide", "data-right"]
          : ["data-right"];

        const rightUpperSrc = getPreviewAssetWithFallbacks(
          rightUpperStyleEl,
          rightUpperBases
        );

        plan.upperRight.src = rightUpperSrc;
        plan.upperRight.show = !!rightUpperSrc;
      }
    }

    return plan;
  }

  function setLayerImage(item, renderVersion) {
    if (!item || !item.el) return;

    const el = item.el;
    const src = normalizePreviewAsset(item.src);
    const show = !!item.show && !!src;

    el.classList.toggle("is-mirrored-x", !!item.mirrorX);
    el.style.removeProperty("scale");

    if (!show) {
      if (el.id !== "preview-base") {
        el.style.display = "none";
      }

      delete el.dataset.desiredSrc;
      el.classList.remove("is-layer-loading", "is-layer-swapping");
      return;
    }

    el.dataset.desiredSrc = src;

    if (el.getAttribute("src") === src) {
      el.style.display = "block";
      el.classList.remove("is-layer-loading");
      return;
    }

    el.classList.add("is-layer-loading");

    const applyNow = (loadedUrl = src) => {
      if (!loadedUrl) return;
      if (renderVersion !== previewRenderVersion) return;
      if (el.dataset.desiredSrc !== src) return;

      el.setAttribute("src", loadedUrl);
      el.style.display = "block";
      el.classList.remove("is-layer-loading");
      el.classList.remove("is-layer-swapping");
      void el.offsetWidth;
      el.classList.add("is-layer-swapping");
      window.setTimeout(() => el.classList.remove("is-layer-swapping"), 260);
    };

    if (imageReadyCache.has(src)) {
      applyNow(src);
      return;
    }

    preloadImage(src).then((loadedUrl) => {
      if (!loadedUrl) {
        /* Do not leave an old door/drawer layer visible after a bad URL. */
        if (
          renderVersion === previewRenderVersion &&
          el.dataset.desiredSrc === src &&
          el.id !== "preview-base"
        ) {
          el.style.display = "none";
          el.classList.remove("is-layer-loading", "is-layer-swapping");
        }
        return;
      }

      applyNow(loadedUrl);
    });
  }

  function applyPreviewPlan(plan, renderVersion) {
    Object.values(plan).forEach((item) => {
      setLayerImage(item, renderVersion);
    });
  }

  function updateAllImages(animate = false) {
    const renderVersion = ++previewRenderVersion;
    const plan = buildPreviewPlan();

    applyPreviewPlan(plan, renderVersion);

    if (animate) {
      pulsePreview();
    }
  }

  function sidesTotal() {
    let total = 0;
    const hasAnySideCabinet = state.leftEnabled || state.rightEnabled;

    if (state.leftEnabled) {
      total += state.leftBase;
      if (state.leftAddons["Left: Add Two Drawers"]) total += 200;
      if (state.leftAddons["Left: Add Upper Door"]) total += getUpperDoorPrice("left");
      if (state.leftAddons["Left: Pull-Out Tray"]) total += 200;
    }

    if (state.rightEnabled) {
      total += state.rightBase;
      if (state.rightAddons["Right: Add Two Drawers"]) total += 200;
      if (state.rightAddons["Right: Add Upper Doors"]) total += getUpperDoorPrice("right");
      if (state.rightAddons["Right: Pull-Out Tray"]) total += 200;
    }

    if (state.bothWide && hasAnySideCabinet) {
      total += state.sideWidePrice;
    } else {
      if (state.leftEnabled && state.leftAddons['Left: Make 22" Wide']) total += state.sideWidePrice;
      if (state.rightEnabled && state.rightAddons['Right: Make 22" Wide']) total += state.sideWidePrice;
    }

    return total;
  }

  function faceFrameTotal() {
    return state.faceFrameConstruction ? state.faceFramePrice : 0;
  }

  function preFinishSubtotal() {
    return (
      state.sizePrice +
      state.doorUpcharge +
      state.crownPrice +
      sidesTotal() +
      faceFrameTotal() +
      state.mattressPrice +
      (state.lights ? state.lightsPrice : 0)
    );
  }

  function paintPercent() {
    const p = parseFloat(paintCheckbox?.dataset.percent || "5");
    return isNaN(p) ? 0.05 : p / 100;
  }

  function finishCharge(pre) {
    return state.finish === "Paint" ? pre * paintPercent() : 0;
  }

  function updatePaintBreakdown(preSubtotal) {
    const enabled = !!paintCheckbox?.checked;
    const add = enabled ? preSubtotal * paintPercent() : 0;
    const total = preSubtotal + add;

    if (paintPriceEl) paintPriceEl.textContent = enabled ? `+$${add.toFixed(0)}` : "+$0";
    if (paintBasePriceEl) paintBasePriceEl.textContent = `$${preSubtotal.toFixed(0)}`;
    if (paintAddAmountEl) paintAddAmountEl.textContent = `$${add.toFixed(0)}`;
    if (paintTotalEl) paintTotalEl.textContent = `$${total.toFixed(0)}`;
  }

  function updatePreviewStatus() {
    if (statusSize) statusSize.textContent = state.size || "No Size";
    if (statusDoor) statusDoor.textContent = state.doorName || "No Door";

    if (state.finish === "Paint") {
      if (statusFinish) statusFinish.textContent = state.paintPreset || "Paint";
    } else if (state.finish === "Stained and Lacquer") {
      if (statusFinish) statusFinish.textContent = state.stainName || "No Finish";
    } else {
      if (statusFinish) statusFinish.textContent = "No Finish";
    }
  }

  function wideSummaryText(side) {
    if (!isWideSide(side)) return null;
    return state.bothWide
      ? `22" Wide`
      : `22" Wide (+$${state.sideWidePrice})`;
  }

  function updateStepCompletion() {
    const completed = {
      1: !!state.size && !!state.doorName,
      2: !!state.crownName,
      3: state.leftEnabled || state.rightEnabled || state.faceFrameConstruction,
      4: state.finish === "Paint" ? !!state.paintPreset : !!state.stainName,
      5: !!state.mattressName,
      6: !!state.lights
    };

    steps.forEach((step) => {
      const stepNo = step.dataset.step;
      step.classList.toggle("is-complete", !!completed[stepNo]);
    });

    const totalCompleted = Object.values(completed).filter(Boolean).length;
    const percentage = (totalCompleted / 6) * 100;

    if (progressFill) progressFill.style.width = `${percentage}%`;
    if (progressTotal) progressTotal.textContent = `${totalCompleted} / 6 customized`;
  }

  function updateTotals() {
    const pre = preFinishSubtotal();
    const fin = finishCharge(pre);
    updatePaintBreakdown(pre);

    const addOnsShown =
      state.doorUpcharge +
      state.crownPrice +
      sidesTotal() +
      faceFrameTotal() +
      state.mattressPrice +
      (state.lights ? state.lightsPrice : 0) +
      fin;

    const grand = state.sizePrice + addOnsShown;
    const grandCents = Math.max(0, Math.round(grand * 100));
    const depositCents = Math.round(grandCents * 0.5);
    const remainingCents = grandCents - depositCents;
    const formatCadFromCents = (cents) =>
      `CAD $${(Math.max(0, cents) / 100).toLocaleString("en-CA", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`;

    builderRoot.dataset.fullOrderTotalCents = String(grandCents);
    builderRoot.dataset.depositAmountCents = String(depositCents);
    builderRoot.dataset.remainingBalanceCents = String(remainingCents);

    if (basePriceEl) basePriceEl.textContent = state.sizePrice.toFixed(0);
    if (addonsPriceEl) addonsPriceEl.textContent = addOnsShown.toFixed(0);
    if (totalPriceEl) totalPriceEl.textContent = grand.toFixed(0);
    if (totalPriceField) totalPriceField.value = `$${grand.toFixed(2)}`;
    if (depositFullOrderTotalEl) depositFullOrderTotalEl.textContent = formatCadFromCents(grandCents);
    if (depositDueTodayEl) depositDueTodayEl.textContent = formatCadFromCents(depositCents);
    if (depositRemainingEl) depositRemainingEl.textContent = formatCadFromCents(remainingCents);

    const depositCheckoutButton = document.getElementById("wizard-checkout");
    if (depositCheckoutButton) {
      depositCheckoutButton.textContent = `Pay 50% Deposit — ${formatCadFromCents(depositCents)}`;
    }

    const leftSummary = state.leftEnabled
      ? [
          `Base $${state.leftBase}`,
          wideSummaryText("left"),
          state.leftAddons["Left: Add Two Drawers"] ? `Drawers: ${(getDrawerStyleEl("left")?.value || "Style")} (+$200)` : null,
          state.leftAddons["Left: Add Upper Door"] ? `Upper: ${(getUpperStyleEl("left")?.value || "Style")} (+$${getUpperDoorPrice("left")})` : null,
          state.leftAddons["Left: Pull-Out Tray"] ? "Pull-Out Tray (+$200)" : null
        ].filter(Boolean).join(", ")
      : "None";

    const rightSummary = state.rightEnabled
      ? [
          `Base $${state.rightBase}`,
          wideSummaryText("right"),
          state.rightAddons["Right: Add Two Drawers"] ? `Drawers: ${(getDrawerStyleEl("right")?.value || "Style")} (+$200)` : null,
          state.rightAddons["Right: Add Upper Doors"] ? `Upper: ${(getUpperStyleEl("right")?.value || "Style")} (+$${getUpperDoorPrice("right")})` : null,
          state.rightAddons["Right: Pull-Out Tray"] ? "Pull-Out Tray (+$200)" : null
        ].filter(Boolean).join(", ")
      : "None";

    if (sizeField) sizeField.value = state.size || "";
    if (doorField) doorField.value = state.doorName || "";
    if (crownField) crownField.value = state.crownName || "";
    if (leftSideField) leftSideField.value = leftSummary;
    if (rightSideField) rightSideField.value = rightSummary;
    if (finishField) finishField.value = state.finish || "";
    if (mattressField) mattressField.value = state.mattressName || "";
    if (lightsField) lightsField.value = state.lights ? "Yes (+$350)" : "No";
    if (faceFrameField) faceFrameField.value = state.faceFrameConstruction ? `Yes (+$${state.faceFramePrice})` : "No";

    if (state.finish === "Paint") {
      if (colorField) colorField.value = state.paintPreset ? `Paint: ${state.paintPreset}` : "Paint";
      if (paintColorNameField) paintColorNameField.value = state.paintPreset || "";
      if (paintColorCodeField) paintColorCodeField.value = state.paintCode || "";
      if (paintSourceField) paintSourceField.value = BM_LINK;

      if (stainColorNameField) stainColorNameField.value = "";
      if (stainColorCodeField) stainColorCodeField.value = "";
      if (stainSourceField) stainSourceField.value = "";
    } else if (state.finish === "Stained and Lacquer") {
      if (colorField) colorField.value = `Stain: ${state.stainName}`;
      if (stainColorNameField) stainColorNameField.value = state.stainName || "";
      if (stainColorCodeField) stainColorCodeField.value = state.stainHex || "";
      if (stainSourceField) stainSourceField.value = STAIN_SOURCE;

      if (paintColorNameField) paintColorNameField.value = "";
      if (paintColorCodeField) paintColorCodeField.value = "";
      if (paintSourceField) paintSourceField.value = "";
    } else {
      if (colorField) colorField.value = "";
      if (paintColorNameField) paintColorNameField.value = "";
      if (paintColorCodeField) paintColorCodeField.value = "";
      if (paintSourceField) paintSourceField.value = "";
      if (stainColorNameField) stainColorNameField.value = "";
      if (stainColorCodeField) stainColorCodeField.value = "";
      if (stainSourceField) stainSourceField.value = "";
    }

    const addons = [];

    if (state.size) {
      addons.push(`Size: ${state.size}`);
    }

    if (state.doorName) {
      addons.push(state.doorUpcharge ? `Door: ${state.doorName} (+$${state.doorUpcharge})` : `Door: ${state.doorName} (Included)`);
    }

    if (state.crownName) {
      addons.push(
        state.crownName === "No Crown"
          ? `Crown: ${state.crownName} (Save $200)`
          : `Crown: ${state.crownName} (+$${state.crownPrice})`
      );
    }

    if (state.leftEnabled) addons.push(`Left Side: ${leftSummary}`);
    if (state.rightEnabled) addons.push(`Right Side: ${rightSummary}`);
    if (state.bothWide && (state.leftEnabled || state.rightEnabled)) {
      addons.push(`Width Upgrade: Make Both Side Cabinets 22" Wide (+$${state.sideWidePrice})`);
    }
    if (state.faceFrameConstruction) {
      addons.push(`Face Frame Construction (+$${state.faceFramePrice})`);
    }

    if (state.finish === "Paint") {
      addons.push(`Finish: Paint (+${(paintPercent() * 100).toFixed(0)}%)`);
      if (state.paintPreset) addons.push(`Paint Color: ${state.paintPreset}`);
      addons.push(`Paint Library: ${BM_LINK}`);
    } else if (state.finish === "Stained and Lacquer") {
      addons.push("Finish: Stained and Lacquer (Included)");
      addons.push(`Stain: ${state.stainName}`);
      addons.push(`Stain Code: ${state.stainHex}`);
    }

    if (state.mattressName) {
      addons.push(state.mattressPrice ? `Mattress: ${state.mattressName} (+$${state.mattressPrice})` : `Mattress: ${state.mattressName}`);
    }

    if (state.lights) addons.push("Lights (+$350)");

    if (addonsField) addonsField.value = addons.join(" | ");
  }

  function refresh(animate = false) {
    hydrateStateFromDOM();
    updateUpperDoorPriceLabels();
    syncSelectableClasses();
    showBmPicker(!!paintCheckbox?.checked);
    updateAllImages(animate);
    updateTotals();
    updatePreviewStatus();
    updateStepCompletion();
  }

  function bindToggleableRadioChoices(containerSelector, stepNo) {
    document.querySelectorAll(containerSelector).forEach((container) => {
      const input = container.querySelector('input[type="radio"]');
      if (!input) return;

      const rememberState = () => {
        container.dataset.wasChecked = input.checked ? "true" : "false";
      };

      container.addEventListener("pointerdown", rememberState);
      container.addEventListener("mousedown", rememberState);
      container.addEventListener("touchstart", rememberState, { passive: true });

      container.addEventListener("click", function (e) {
        const now = Date.now();
        const preventUntil = num(container.dataset.preventReselectUntil || 0);
        const wasChecked = container.dataset.wasChecked === "true";

        if (preventUntil && now < preventUntil) {
          e.preventDefault();
          input.checked = false;
          container.dataset.wasChecked = "false";
          setActiveStep(stepNo);
          refresh(true);
          return;
        }

        if (wasChecked) {
          e.preventDefault();
          input.checked = false;
          container.dataset.wasChecked = "false";
          container.dataset.preventReselectUntil = String(now + 280);
          setActiveStep(stepNo);
          refresh(true);
        }
      });

      container.addEventListener("dblclick", function (e) {
        e.preventDefault();
        input.checked = false;
        container.dataset.wasChecked = "false";
        container.dataset.preventReselectUntil = String(Date.now() + 280);
        setActiveStep(stepNo);
        refresh(true);
      });
    });
  }

  window.selStain = function (card) {
    if (!card) return;

    stainCards.forEach((item) => item.classList.remove("is-selected"));
    card.classList.add("is-selected");

    if (paintCheckbox) paintCheckbox.checked = false;
    bmPresetRadios.forEach((input) => {
      input.checked = false;
    });

    showBmPicker(false);
    setActiveStep(4);
    refresh(true);
    window.setTimeout(warmPreloadCurrentFinishAssets, 20);
  };

  window.togglePaint = function () {
    const isOn = !!paintCheckbox?.checked;

    if (isOn) {
      stainCards.forEach((card) => card.classList.remove("is-selected"));
      showBmPicker(true);
    } else {
      bmPresetRadios.forEach((input) => {
        input.checked = false;
      });

      const defaultStainCard =
        Array.from(stainCards).find(
          (card) =>
            String(card.dataset.key || "") === "light-walnut" ||
            String(card.dataset.name || "") === "Light Walnut"
        ) ||
        stainCards[0];

      if (defaultStainCard) {
        stainCards.forEach((card) => card.classList.remove("is-selected"));
        defaultStainCard.classList.add("is-selected");
      }

      showBmPicker(false);
    }

    setActiveStep(4);
    refresh(true);
    window.setTimeout(warmPreloadCurrentFinishAssets, 20);
  };

  function bindDoorCards() {
    doorCards.forEach((card) => {
      card.addEventListener("click", function () {
        doorCards.forEach((item) => item.classList.remove("selected"));
        card.classList.add("selected");
        setActiveStep(1);
        refresh(true);
      });

      card.addEventListener("pointerenter", function () {
        preloadImages(collectCurrentFinishUrls(card), 3);
      });
    });
  }

  function bindRadioGroups() {
    sizeRadios.forEach((input) => {
      input.addEventListener("change", () => {
        setActiveStep(1);
        refresh(true);
      });
    });

    crownRadios.forEach((input) => {
      input.addEventListener("change", () => {
        setActiveStep(2);
        refresh(true);
      });
    });

    mattressRadios.forEach((input) => {
      input.addEventListener("change", () => {
        setActiveStep(5);
        refresh(true);
      });
    });

    bmPresetRadios.forEach((input) => {
      input.addEventListener("change", () => {
        setActiveStep(4);
        refresh(true);
      });
    });

    document.querySelectorAll('input[name="left-drawer-style"], input[name="right-drawer-style"]').forEach((input) => {
      input.addEventListener("change", () => {
        setActiveStep(3);
        refresh(true);
      });
    });

    document.querySelectorAll('input[name="left-upper-style"], input[name="right-upper-style"]').forEach((input) => {
      input.addEventListener("change", () => {
        setActiveStep(3);
        refresh(true);
      });
    });

  }

  function bindCheckboxes() {
    if (leftToggle) {
      leftToggle.addEventListener("change", () => {
        if (leftAddonsBox) leftAddonsBox.style.display = leftToggle.checked ? "block" : "none";

        if (!leftToggle.checked) {
          document.querySelectorAll('.side-addon[data-side="left"]').forEach((input) => {
            input.checked = false;
          });
          document.querySelectorAll('input[name="left-drawer-style"], input[name="left-upper-style"]').forEach((input) => {
            input.checked = false;
          });
          if (leftDrawerGroup) leftDrawerGroup.style.display = "none";
          if (leftUpperGroup) leftUpperGroup.style.display = "none";
        } else {
          if (leftDrawerGroup && document.querySelector('.toggle-drawer[data-side="left"]')?.checked) {
            leftDrawerGroup.style.display = "block";
            ensureFirstChecked(leftDrawerGroup);
          }
          if (leftUpperGroup && document.querySelector('.toggle-upper[data-side="left"]')?.checked) {
            leftUpperGroup.style.display = "block";
            ensureFirstChecked(leftUpperGroup);
          }
        }

        setActiveStep(3);
        refresh(true);
      });
    }

    if (rightToggle) {
      rightToggle.addEventListener("change", () => {
        if (rightAddonsBox) rightAddonsBox.style.display = rightToggle.checked ? "block" : "none";

        if (!rightToggle.checked) {
          document.querySelectorAll('.side-addon[data-side="right"]').forEach((input) => {
            input.checked = false;
          });
          document.querySelectorAll('input[name="right-drawer-style"], input[name="right-upper-style"]').forEach((input) => {
            input.checked = false;
          });
          if (rightDrawerGroup) rightDrawerGroup.style.display = "none";
          if (rightUpperGroup) rightUpperGroup.style.display = "none";
        } else {
          if (rightDrawerGroup && document.querySelector('.toggle-drawer[data-side="right"]')?.checked) {
            rightDrawerGroup.style.display = "block";
            ensureFirstChecked(rightDrawerGroup);
          }
          if (rightUpperGroup && document.querySelector('.toggle-upper[data-side="right"]')?.checked) {
            rightUpperGroup.style.display = "block";
            ensureFirstChecked(rightUpperGroup);
          }
        }

        setActiveStep(3);
        refresh(true);
      });
    }

    document.querySelectorAll(".side-addon, .side-wide-sync, .face-frame-sync").forEach((chk) => {
      chk.addEventListener("change", () => {
        const side = chk.dataset.side;

        if (chk.classList.contains("toggle-drawer")) {
          const group = side === "left" ? leftDrawerGroup : rightDrawerGroup;
          if (group) {
            group.style.display = chk.checked ? "block" : "none";
            if (chk.checked) {
              ensureFirstChecked(group);
            } else {
              group.querySelectorAll('input[type="radio"]').forEach((input) => {
                input.checked = false;
              });
            }
          }
        }

        if (chk.classList.contains("toggle-upper")) {
          const group = side === "left" ? leftUpperGroup : rightUpperGroup;
          if (group) {
            group.style.display = chk.checked ? "block" : "none";
            if (chk.checked) {
              ensureFirstChecked(group);
            } else {
              group.querySelectorAll('input[type="radio"]').forEach((input) => {
                input.checked = false;
              });
            }
          }
        }

        setActiveStep(3);
        refresh(true);
      });
    });

    if (lightsCheckbox) {
      lightsCheckbox.addEventListener("change", () => {
        setActiveStep(6);
        refresh(true);
      });
    }
  }

  function resetBuilder() {
    if (form) form.reset();
    clearCustomSelections();
    setActiveStep(1);
    refresh(true);
  }

 function getCheckoutVariantId() {
  const candidates = [
    document.getElementById("variant-id"),
    document.querySelector('#murphy-form input[name="id"]'),
    document.querySelector('#murphy-form select[name="id"]'),
    document.querySelector("[data-variant-id]"),
    document.querySelector('form[action*="/cart/add"] input[name="id"]'),
    document.querySelector('form[action*="/cart/add"] select[name="id"]')
  ];

  for (const el of candidates) {
    if (!el) continue;

    const value =
      el.value ||
      el.getAttribute("value") ||
      el.dataset?.variantId ||
      el.getAttribute("data-variant-id") ||
      "";

    const cleaned = String(value).trim();
    if (/^\d+$/.test(cleaned)) return cleaned;
  }

  const metaVariant =
    window.ShopifyAnalytics?.meta?.product?.variants?.[0]?.id ||
    window.meta?.product?.variants?.[0]?.id ||
    "";

  const cleanedMeta = String(metaVariant || "").trim();
  return /^\d+$/.test(cleanedMeta) ? cleanedMeta : "";
}

async function createDraftOrder(total) {
  const variantId = getCheckoutVariantId();

  const props = {
    Size: sizeField?.value || "",
    Door: doorField?.value || "",
    Crown: crownField?.value || "",
    "Left Side": leftSideField?.value || "",
    "Right Side": rightSideField?.value || "",
    Finish: finishField?.value || "",
    Color: colorField?.value || "",
    Mattress: mattressField?.value || "",
    Lights: lightsField?.value || "",
    "Face Frame Construction": faceFrameField?.value || "",
    "Addons Summary": addonsField?.value || "",
    "Calculated Price": totalPriceField?.value || `$${num(total).toFixed(2)}`
  };

  if (state.finish === "Paint") {
    props["Paint Selection"] = state.paintPreset || "";
    props["Paint Color Code"] = state.paintCode || "";
    props["Paint Color Library"] = BM_LINK;
  } else if (state.finish === "Stained and Lacquer") {
    props["Stain Name"] = state.stainName || "";
    props["Stain Code"] = state.stainHex || "";
    props["Stain Source"] = STAIN_SOURCE;
  }

  const finalTotal = Math.max(0, num(total));
  const basePrice = Math.max(0, num(state.sizePrice));
  const customizationPrice = Math.max(0, finalTotal - basePrice);

  /*
   * The new API supports a custom-line fallback when no valid Shopify
   * variant ID is available. Therefore checkout must not be blocked when
   * the hidden variant input is missing.
   */
  const payload = {
    title: "Murphy Bed (Customizable)",
    quantity: 1,
    currencyCode: "CAD",

    basePriceCents: Math.round(basePrice * 100),
    customizationPriceCents: Math.round(customizationPrice * 100),
    finalTotalCents: Math.round(finalTotal * 100),

    // Retained for backward compatibility with the previous API.
    price: finalTotal,

    allowCustomLineFallback: true,
    properties: props
  };

  if (variantId) {
    payload.variantId = variantId;
    payload.variant_id = variantId;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 30000);

  let response;

  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Checkout request timed out. Please try again.");
    }

    throw new Error(
      "Could not connect to the checkout service. Check the Vercel deployment and allowed origins."
    );
  } finally {
    window.clearTimeout(timeoutId);
  }

  const data = await response.json().catch(() => ({}));

  const invoiceUrl =
    data?.invoice_url ||
    data?.invoiceUrl ||
    data?.checkout_url ||
    data?.checkoutUrl ||
    data?.url ||
    data?.draft_order?.invoice_url ||
    data?.draftOrder?.invoiceUrl ||
    "";

  if (!response.ok || !invoiceUrl) {
    const apiErrors = Array.isArray(data?.errors)
      ? data.errors.filter(Boolean).join(", ")
      : "";

    const errorCode = data?.code ? `[${data.code}] ` : "";

    throw new Error(
      errorCode +
      (
        data?.error ||
        data?.message ||
        apiErrors ||
        `Draft order API failed with status ${response.status}.`
      )
    );
  }

  return invoiceUrl;
}

  function setLoading(isLoading) {
    const btn = document.querySelector("#murphy-form button[type='submit']");
    if (!btn) return;

    if (isLoading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.textContent = "Please wait…";
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || "Add to Cart";
    }
  }

  bindDoorCards();
  bindRadioGroups();
  bindCheckboxes();


  if (resetButton) {
    resetButton.addEventListener("click", resetBuilder);
  }

  if (form) {
    form.addEventListener("submit", async function (e) {
      e.preventDefault();

      hydrateStateFromDOM();

      const total =
        state.sizePrice +
        state.doorUpcharge +
        state.crownPrice +
        sidesTotal() +
        faceFrameTotal() +
        state.mattressPrice +
        (state.lights ? state.lightsPrice : 0) +
        finishCharge(preFinishSubtotal());

      if (totalPriceField) totalPriceField.value = `$${total.toFixed(2)}`;

      try {
        setLoading(true);
        const invoiceUrl = await createDraftOrder(total);
        window.location.href = invoiceUrl;
      } catch (error) {
        console.error(error);
        const checkoutError = document.getElementById("wizard-validation-message");
        if (checkoutError) {
          checkoutError.textContent = "Could not create checkout. " + (error.message || error);
          checkoutError.classList.add("is-visible");
          checkoutError.setAttribute("role", "alert");
          checkoutError.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      } finally {
        setLoading(false);
      }
    });
  }

  clearCustomSelections();
  setActiveStep(1);
  refresh(false);
  bindPreviewIntentPreloading();
  warmPreloadCurrentFinishAssets();

}


/* =========================================================
   GUIDED STEP-BY-STEP WIZARD CONTROLLER
   Preserves the existing preview, pricing and checkout engine.
   ========================================================= */
function initMurphyBuilderWizard(scope) {
  const searchRoot = scope || document;
  const builderRoot = searchRoot.matches?.("[data-imb-guided-builder]")
    ? searchRoot
    : searchRoot.querySelector?.("[data-imb-guided-builder]") ||
      document.querySelector("[data-imb-guided-builder]");

  if (!builderRoot) return;

  const optionsContainer = document.querySelector("[data-wizard-options]");
  const optionsSummary = document.querySelector(".options-summary");
  const existingStepOne = optionsContainer?.querySelector('.builder-step[data-step="1"]');

  if (!optionsContainer || !optionsSummary || !existingStepOne) return;
  if (optionsSummary.dataset.wizardInitialized === "true") return;
  optionsSummary.dataset.wizardInitialized = "true";

  const totalSteps = 8;
  const stepTitles = [
    "Choose Your Size",
    "Choose Your Door Style",
    "Choose Crown Detail",
    "Configure Side Storage",
    "Select Your Finish",
    "Choose Your Mattress",
    "Add Integrated Lighting",
    "Review Your Murphy Bed"
  ];

  const stepDescriptions = [
    "Select the mattress size that best fits the room and intended use.",
    "Choose the front profile that defines the appearance of your Murphy bed.",
    "Select a clean modern top or a more traditional crown treatment.",
    "Add left, right or dual cabinetry and configure storage upgrades.",
    "Choose a wood stain or Benjamin Moore paint colour for the final finish.",
    "Keep the included Siesta mattress or select a comfort upgrade.",
    "Choose whether to include integrated lighting in your configuration.",
    "Confirm every selection and review the final configured price."
  ];

  const stepTitleEl = document.getElementById("wizard-step-title");
  const stepCountEl = document.getElementById("wizard-step-count");
  const progressFillEl = document.getElementById("wizard-progress-fill");
  const dotsEl = document.getElementById("wizard-step-dots");
  const backButton = document.getElementById("wizard-back");
  const nextButton = document.getElementById("wizard-next");
  const checkoutButton = document.getElementById("wizard-checkout");
  const validationMessage = document.getElementById("wizard-validation-message");
  const priceCard = document.querySelector(".wizard-summary-container");
  const previewContainer = document.querySelector(".preview-container");

  let currentWizardStep = 0;

  function createSizePanel() {
    const sizeOptions = existingStepOne.querySelector(".size-options");
    if (!sizeOptions) return null;

    const panel = document.createElement("section");
    panel.className = "builder-step wizard-generated-size-step";
    panel.dataset.wizardPanel = "1";
    panel.setAttribute("aria-labelledby", "wizard-size-title");

    panel.innerHTML = `
      <div class="step-head wizard-step-head">
        <div class="step-number">1</div>
        <div class="step-copy">
          <span class="wizard-step-eyebrow">First decision</span>
          <h3 id="wizard-size-title">Choose Your Bed Size</h3>
          <p>${stepDescriptions[0]}</p>
        </div>
      </div>
      <div class="wizard-option-intro">
        <strong>Every Murphy Bed includes a complimentary Siesta mattress.</strong>
        <span>You can change the mattress in a later step.</span>
      </div>
    `;

    panel.appendChild(sizeOptions);
    optionsContainer.insertBefore(panel, existingStepOne);
    return panel;
  }

  function improveDoorPanel() {
    existingStepOne.dataset.wizardPanel = "2";

    const head = existingStepOne.querySelector(".step-head");
    const number = head?.querySelector(".step-number");
    const title = head?.querySelector(".step-copy h3");
    const description = head?.querySelector(".step-copy p");

    if (number) number.textContent = "2";
    if (title) title.textContent = "Choose Your Door Style";
    if (description) description.textContent = stepDescriptions[1];

    existingStepOne.querySelectorAll(":scope > h3").forEach(function (heading) {
      if (heading.textContent.includes("Complimentary Siesta Mattress")) {
        heading.remove();
      } else if (heading.textContent.includes("Pick Door")) {
        heading.textContent = "Select a door profile";
      }
    });
  }

  function prepareExistingPanels() {
    const mapping = {
      "2": { wizard: "3", number: "3", title: stepTitles[2], description: stepDescriptions[2] },
      "3": { wizard: "4", number: "4", title: stepTitles[3], description: stepDescriptions[3] },
      "4": { wizard: "5", number: "5", title: stepTitles[4], description: stepDescriptions[4] },
      "5": { wizard: "6", number: "6", title: stepTitles[5], description: stepDescriptions[5] },
      "6": { wizard: "7", number: "7", title: stepTitles[6], description: stepDescriptions[6] }
    };

    Object.keys(mapping).forEach(function (originalStep) {
      const config = mapping[originalStep];
      const panel = optionsContainer.querySelector(`.builder-step[data-step="${originalStep}"]`);
      if (!panel) return;

      panel.dataset.wizardPanel = config.wizard;

      const head = panel.querySelector(".step-head");
      const number = head?.querySelector(".step-number");
      const title = head?.querySelector(".step-copy h3");
      const description = head?.querySelector(".step-copy p");

      if (number) number.textContent = config.number;
      if (title) title.textContent = config.title;
      if (description) description.textContent = config.description;
    });
  }

  function createLightingChoices() {
    const lightingPanel = optionsContainer.querySelector('[data-wizard-panel="7"]');
    const originalLightLabel = lightingPanel?.querySelector(".lights-option");
    const lightCheckbox = document.getElementById("lights");

    if (!lightingPanel || !originalLightLabel || !lightCheckbox) return;
    if (lightingPanel.querySelector(".wizard-binary-options")) return;

    originalLightLabel.classList.add("wizard-original-light-control");
    originalLightLabel.hidden = false;

    const choiceGrid = document.createElement("div");
    choiceGrid.className = "wizard-binary-options";
    choiceGrid.innerHTML = `
      <button type="button" class="wizard-binary-choice" data-light-choice="no">
        <span class="wizard-binary-choice__icon">—</span>
        <span>
          <strong>No Integrated Lighting</strong>
          <small>No additional charge</small>
        </span>
      </button>

      <button type="button" class="wizard-binary-choice" data-light-choice="yes">
        <span class="wizard-binary-choice__icon">+</span>
        <span>
          <strong>Add Integrated Lighting</strong>
          <small>+$350</small>
        </span>
      </button>
    `;

    if (originalLightLabel.parentNode) {
      originalLightLabel.parentNode.insertBefore(choiceGrid, originalLightLabel);
    } else {
      return;
    }

    function syncLightingChoices() {
      choiceGrid.querySelectorAll("[data-light-choice]").forEach(function (button) {
        const shouldSelect =
          (button.dataset.lightChoice === "yes" && lightCheckbox.checked) ||
          (button.dataset.lightChoice === "no" && !lightCheckbox.checked);

        button.classList.toggle("is-selected", shouldSelect);
        button.setAttribute("aria-pressed", shouldSelect ? "true" : "false");
      });
    }

    choiceGrid.addEventListener("click", function (event) {
      const button = event.target.closest("[data-light-choice]");
      if (!button) return;

      lightCheckbox.checked = button.dataset.lightChoice === "yes";
      lightCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
      syncLightingChoices();
    });

    syncLightingChoices();
  }

  function createReviewPanel() {
    const panel = document.createElement("section");
    panel.className = "builder-step wizard-review-step";
    panel.dataset.wizardPanel = "8";
    panel.innerHTML = `
      <div class="step-head wizard-step-head">
        <div class="step-number">8</div>
        <div class="step-copy">
          <span class="wizard-step-eyebrow">Final review</span>
          <h3>Review Your Murphy Bed</h3>
          <p>${stepDescriptions[7]}</p>
        </div>
      </div>

      <div class="wizard-review-list" id="wizard-review-list"></div>

      <div class="wizard-deposit-review" id="wizard-deposit-review" aria-live="polite"></div>

      <div class="wizard-review-note">
        <strong>Your selections are ready.</strong>
        <span>You can use Back to make changes before continuing to checkout.</span>
      </div>
    `;

    const hiddenAssetHolder = Array.from(optionsContainer.children).find(function (child) {
      return child.matches('div[style*="display:none"]');
    });

    optionsContainer.insertBefore(panel, hiddenAssetHolder || null);
    return panel;
  }

  const sizePanel = createSizePanel();
  improveDoorPanel();
  prepareExistingPanels();
  createLightingChoices();
  const reviewPanel = createReviewPanel();

  const panels = Array.from(optionsContainer.querySelectorAll("[data-wizard-panel]"))
    .sort(function (a, b) {
      return Number(a.dataset.wizardPanel) - Number(b.dataset.wizardPanel);
    });

  function buildProgressDots() {
    if (!dotsEl) return;

    dotsEl.innerHTML = stepTitles.map(function (title, index) {
      return `
        <button
          type="button"
          class="wizard-step-dot"
          data-wizard-dot="${index}"
          aria-label="Go to step ${index + 1}: ${title}"
          title="${title}">
          <span>${index + 1}</span>
        </button>
      `;
    }).join("");
  }

  function fieldValue(id, fallback) {
    const field = document.getElementById(id);
    const value = String(field?.value || "").trim();
    return value || fallback;
  }

  function formatCadFromCents(cents) {
    const safeCents = Math.max(0, Math.round(Number(cents) || 0));
    return `CAD $${(safeCents / 100).toLocaleString("en-CA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  function currentDepositAmounts() {
    let fullOrderTotalCents = Number(builderRoot.dataset.fullOrderTotalCents || 0);

    if (!Number.isFinite(fullOrderTotalCents) || fullOrderTotalCents <= 0) {
      const totalText = String(document.getElementById("total-price")?.textContent || "0")
        .replace(/[^0-9.]/g, "");
      fullOrderTotalCents = Math.max(0, Math.round((Number(totalText) || 0) * 100));
    }

    const depositAmountCents = Math.round(fullOrderTotalCents * 0.5);
    const remainingBalanceCents = fullOrderTotalCents - depositAmountCents;

    return { fullOrderTotalCents, depositAmountCents, remainingBalanceCents };
  }

  function currentTotalText() {
    return formatCadFromCents(currentDepositAmounts().fullOrderTotalCents);
  }

  function updateReview() {
    const reviewList = document.getElementById("wizard-review-list");
    if (!reviewList) return;

    const amounts = currentDepositAmounts();
    const entries = [
      ["Size", fieldValue("size-field", "Not selected")],
      ["Door Style", fieldValue("door-field", "Not selected")],
      ["Crown", fieldValue("crown-field", "No Crown")],
      ["Left Cabinet", fieldValue("left-side-field", "None")],
      ["Right Cabinet", fieldValue("right-side-field", "None")],
      ["Finish", fieldValue("color-field", fieldValue("finish-field", "Not selected"))],
      ["Mattress", fieldValue("mattress-field", "Siesta Mattress")],
      ["Lighting", fieldValue("lights-field", "No")],
      ["Configured Total", currentTotalText()]
    ];

    reviewList.innerHTML = entries.map(function (entry, index) {
      const isTotal = index === entries.length - 1;
      return `
        <div class="wizard-review-row${isTotal ? " wizard-review-row--total" : ""}">
          <span>${entry[0]}</span>
          <strong>${entry[1]}</strong>
        </div>
      `;
    }).join("");

    const depositReview = document.getElementById("wizard-deposit-review");
    if (depositReview) {
      depositReview.innerHTML = `
        <div class="wizard-deposit-review__eyebrow">50% Deposit Payment</div>
        <div class="wizard-deposit-review__row">
          <span>Full Order Total</span>
          <strong>${formatCadFromCents(amounts.fullOrderTotalCents)}</strong>
        </div>
        <div class="wizard-deposit-review__row wizard-deposit-review__row--today">
          <span>Due Today — 50% Deposit</span>
          <strong>${formatCadFromCents(amounts.depositAmountCents)}</strong>
        </div>
        <div class="wizard-deposit-review__row">
          <span>Remaining 50% — Due After Professional Installation Service</span>
          <strong>${formatCadFromCents(amounts.remainingBalanceCents)}</strong>
        </div>
        <p>Pay 50% today to confirm your Murphy bed order. After professional installation service is completed, our team will contact you to collect the remaining 50%. No automatic second charge will be made.</p>
        <small>Sales Tax is calculated securely by the checkout service and added at checkout.</small>
      `;
    }

    if (checkoutButton) {
      checkoutButton.textContent = `Pay 50% Deposit — ${formatCadFromCents(amounts.depositAmountCents)}`;
    }
  }

  function validateStep(stepIndex) {
    const messages = {
      0: "Please choose a bed size before continuing.",
      1: "Please choose a door style before continuing.",
      2: "Please choose a crown option before continuing.",
      4: "Please choose a wood stain or a Benjamin Moore paint colour before continuing.",
      5: "Please choose a mattress option before continuing."
    };

    let valid = true;

    if (stepIndex === 0) {
      valid = !!document.querySelector('.size-option input[type="radio"]:checked');
    } else if (stepIndex === 1) {
      valid = !!document.querySelector(".door-option.selected");
    } else if (stepIndex === 2) {
      valid = !!document.querySelector('.crown-option input[type="radio"]:checked');
    } else if (stepIndex === 4) {
      const paintChecked = !!document.getElementById("paintCheckbox")?.checked;
      const paintColour = !!document.querySelector('#bmPaintPicker input[name="bm-color"]:checked');
      const stain = !!document.querySelector(".stain-card.is-selected");
      valid = (paintChecked && paintColour) || stain;
    } else if (stepIndex === 5) {
      valid = !!document.querySelector('.mattress-options input[type="radio"]:checked');
    }

    if (!valid && validationMessage) {
      validationMessage.textContent = messages[stepIndex] || "Please make a selection before continuing.";
      validationMessage.classList.add("is-visible");
    }

    return valid;
  }

  function clearValidation() {
    if (!validationMessage) return;
    validationMessage.textContent = "";
    validationMessage.classList.remove("is-visible");
  }

  function scrollWizardIntoView() {
    const target = window.innerWidth <= 1180 ? optionsSummary : document.querySelector(".builder-progress");

    if (target) {
      const headerOffset = 100;
      const top = target.getBoundingClientRect().top + window.scrollY - headerOffset;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
  }

  function renderWizard(options) {
    const config = options || {};
    clearValidation();

    panels.forEach(function (panel, index) {
      const isCurrent = index === currentWizardStep;
      panel.classList.toggle("wizard-current", isCurrent);
      panel.hidden = !isCurrent;
      panel.setAttribute("aria-hidden", isCurrent ? "false" : "true");
    });

    if (stepTitleEl) stepTitleEl.textContent = stepTitles[currentWizardStep];
    if (stepCountEl) stepCountEl.textContent = `Step ${currentWizardStep + 1} of ${totalSteps}`;
    if (progressFillEl) progressFillEl.style.width = `${((currentWizardStep + 1) / totalSteps) * 100}%`;

    if (dotsEl) {
      dotsEl.querySelectorAll("[data-wizard-dot]").forEach(function (dot, index) {
        dot.classList.toggle("is-current", index === currentWizardStep);
        dot.classList.toggle("is-complete", index < currentWizardStep);
        dot.disabled = index > currentWizardStep;
      });
    }

    if (backButton) {
      backButton.hidden = currentWizardStep === 0;
      backButton.disabled = currentWizardStep === 0;
    }

    const isReview = currentWizardStep === totalSteps - 1;

    if (nextButton) {
      nextButton.hidden = isReview;
      nextButton.textContent = currentWizardStep === totalSteps - 2 ? "Review My Bed →" : "Next Step →";
    }

    if (checkoutButton) {
      checkoutButton.hidden = !isReview;
    }

    optionsSummary.classList.toggle("is-review-step", isReview);

    if (isReview) {
      updateReview();
    }

    try {
      sessionStorage.setItem("imbWizardStep", String(currentWizardStep));
    } catch (error) {}

    if (config.scroll !== false) {
      scrollWizardIntoView();
    }
  }

  function goNext() {
    if (!validateStep(currentWizardStep)) return;
    if (currentWizardStep >= totalSteps - 1) return;

    currentWizardStep += 1;
    renderWizard();
  }

  function goBack() {
    if (currentWizardStep <= 0) return;
    currentWizardStep -= 1;
    renderWizard();
  }

  buildProgressDots();

  if (nextButton) nextButton.addEventListener("click", goNext);
  if (backButton) backButton.addEventListener("click", goBack);

  if (dotsEl) {
    dotsEl.addEventListener("click", function (event) {
      const dot = event.target.closest("[data-wizard-dot]");
      if (!dot || dot.disabled) return;

      const requestedStep = Number(dot.dataset.wizardDot);
      if (!Number.isFinite(requestedStep) || requestedStep > currentWizardStep) return;

      currentWizardStep = requestedStep;
      renderWizard();
    });
  }

  optionsContainer.addEventListener("change", function () {
    clearValidation();
    if (currentWizardStep === totalSteps - 1) {
      window.setTimeout(updateReview, 30);
    }
  });

  optionsContainer.addEventListener("click", function (event) {
    if (
      event.target.closest(
        ".door-option, .stain-card, .bm-option, .size-option, .crown-option, .mattress-options label, .side-toggle, .side-addons label"
      )
    ) {
      clearValidation();
      if (currentWizardStep === totalSteps - 1) {
        window.setTimeout(updateReview, 30);
      }
    }
  });

  const resetButton = document.getElementById("preview-reset");
  if (resetButton) {
    resetButton.addEventListener("click", function () {
      currentWizardStep = 0;
      window.setTimeout(function () {
        renderWizard({ scroll: false });
      }, 50);
    });
  }

  // Start from the first decision every time the builder is newly opened.
  currentWizardStep = 0;
  renderWizard({ scroll: false });
  builderRoot.classList.add("is-wizard-ready");

  // Keep current price visible under the active decision.
  if (priceCard && window.ResizeObserver) {
    const observer = new ResizeObserver(function () {
      priceCard.style.setProperty("--wizard-summary-height", `${priceCard.offsetHeight}px`);
    });
    observer.observe(priceCard);
  }

  if (previewContainer) {
    previewContainer.setAttribute("aria-label", "Live Murphy bed preview");
  }

}


function bootMurphyBuilder(scope) {
  initMurphyBuilderCore(scope);
  initMurphyBuilderWizard(scope);
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    function () {
      bootMurphyBuilder(document);
    },
    { once: true }
  );
} else {
  bootMurphyBuilder(document);
}

document.addEventListener("shopify:section:load", function (event) {
  bootMurphyBuilder(event.target);
});

document.addEventListener("shopify:section:select", function (event) {
  const root = event.target.matches?.("[data-imb-guided-builder]")
    ? event.target
    : event.target.querySelector?.("[data-imb-guided-builder]");

  if (root) {
    const progress = root.querySelector(".builder-progress--wizard");
    progress?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
});

/* =========================================================
   AI ROOM VISUALIZER
   Captures the configured transparent bed layers, composites
   them onto a customer room photo and sends the composite to
   the Cloudflare Workers AI endpoint configured in the section.
   ========================================================= */
function initMurphyRoomVisualizer(scope) {
  const searchRoot = scope || document;
  const builderRoot = searchRoot.matches?.("[data-imb-guided-builder]")
    ? searchRoot
    : searchRoot.querySelector?.("[data-imb-guided-builder]") ||
      document.querySelector("[data-imb-guided-builder]");

  if (!builderRoot || builderRoot.dataset.roomVisualizerInitialized === "true") return;

  const endpointOrigin = String(builderRoot.dataset.roomVisualizerEndpoint || "")
    .trim()
    .replace(/\/$/, "");
  const reviewPanel = builderRoot.querySelector('[data-wizard-panel="8"]');
  const previewStage = builderRoot.querySelector("#preview-stage");

  if (!reviewPanel || !previewStage) return;
  builderRoot.dataset.roomVisualizerInitialized = "true";

  const visualizer = document.createElement("section");
  visualizer.className = "room-visualizer";
  visualizer.setAttribute("aria-labelledby", "room-visualizer-title");
  visualizer.innerHTML = `
    <div class="room-visualizer__heading">
      <span class="room-visualizer__eyebrow">AI room preview</span>
      <h4 id="room-visualizer-title">See It in Your Room</h4>
      <p>Upload a clear photo of the wall where your Murphy bed will be installed.</p>
    </div>

    <div
      class="room-visualizer__dropzone"
      id="room-visualizer-dropzone"
      role="button"
      tabindex="0"
      aria-controls="room-photo-input"
      aria-label="Upload a room photo">
      <input
        type="file"
        id="room-photo-input"
        accept="image/jpeg,image/png,image/webp"
        hidden>
      <span class="room-visualizer__upload-icon" aria-hidden="true">+</span>
      <strong>Upload your room photo</strong>
      <span>JPG, PNG or WebP · Maximum 8 MB</span>
    </div>

    <div class="room-visualizer__file" id="room-visualizer-file" hidden>
      <div>
        <strong id="room-visualizer-file-name"></strong>
        <span id="room-visualizer-file-size"></span>
      </div>
      <button type="button" id="room-visualizer-remove">Remove</button>
    </div>

    <div class="room-visualizer__message" id="room-visualizer-message" role="status" aria-live="polite"></div>

    <button type="button" class="room-visualizer__generate" id="room-visualizer-generate" disabled>
      <span class="room-visualizer__generate-label">Generate My Room Preview</span>
      <span class="room-visualizer__spinner" aria-hidden="true"></span>
    </button>

    <div class="room-visualizer__result" id="room-visualizer-result" hidden>
      <img id="room-visualizer-result-image" alt="AI visualization of the configured Murphy bed in the uploaded room">
      <div class="room-visualizer__result-actions">
        <a id="room-visualizer-download" download="my-murphy-bed-room-preview.png">Download Preview</a>
        <button type="button" id="room-visualizer-again">Generate Again</button>
      </div>
    </div>

    <p class="room-visualizer__notice">
      AI-generated visualization for inspiration only. Final scale, colour and placement may vary.
      Your photo is processed for this preview and is not saved by this feature.
    </p>
  `;

  const depositReview = reviewPanel.querySelector("#wizard-deposit-review");
  reviewPanel.insertBefore(visualizer, depositReview || null);

  const input = visualizer.querySelector("#room-photo-input");
  const dropzone = visualizer.querySelector("#room-visualizer-dropzone");
  const fileRow = visualizer.querySelector("#room-visualizer-file");
  const fileName = visualizer.querySelector("#room-visualizer-file-name");
  const fileSize = visualizer.querySelector("#room-visualizer-file-size");
  const removeButton = visualizer.querySelector("#room-visualizer-remove");
  const generateButton = visualizer.querySelector("#room-visualizer-generate");
  const message = visualizer.querySelector("#room-visualizer-message");
  const result = visualizer.querySelector("#room-visualizer-result");
  const resultImage = visualizer.querySelector("#room-visualizer-result-image");
  const download = visualizer.querySelector("#room-visualizer-download");
  const againButton = visualizer.querySelector("#room-visualizer-again");

  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const VALID_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const MAX_GENERATIONS = 2;
  let selectedFile = null;
  let activeRequest = null;
  let resultUrl = "";

  function generationCount() {
    try {
      return Number(sessionStorage.getItem("imbRoomPreviewCount") || 0);
    } catch (error) {
      return 0;
    }
  }

  function setGenerationCount(value) {
    try {
      sessionStorage.setItem("imbRoomPreviewCount", String(value));
    } catch (error) {}
  }

  function setMessage(text, tone) {
    message.textContent = text || "";
    message.dataset.tone = tone || "neutral";
  }

  function setBusy(isBusy) {
    visualizer.classList.toggle("is-busy", isBusy);
    generateButton.disabled = isBusy || !selectedFile;
    generateButton.setAttribute("aria-busy", isBusy ? "true" : "false");
    input.disabled = isBusy;
    removeButton.disabled = isBusy;
  }

  function clearResult() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = "";
    result.hidden = true;
    resultImage.removeAttribute("src");
    download.removeAttribute("href");
  }

  function resetFile() {
    selectedFile = null;
    input.value = "";
    fileRow.hidden = true;
    dropzone.hidden = false;
    generateButton.disabled = true;
    clearResult();
    setMessage("", "neutral");
  }

  function selectFile(file) {
    clearResult();

    if (!file) return resetFile();
    if (!VALID_TYPES.includes(file.type)) {
      resetFile();
      setMessage("Please choose a JPG, PNG or WebP room photo.", "error");
      return;
    }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      resetFile();
      setMessage("The room photo must be smaller than 8 MB.", "error");
      return;
    }

    selectedFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB`;
    fileRow.hidden = false;
    dropzone.hidden = true;
    generateButton.disabled = false;
    setMessage("Photo ready. Generate your personalized room preview.", "success");
  }

  function openPicker() {
    if (!input.disabled) input.click();
  }

  dropzone.addEventListener("click", openPicker);
  dropzone.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  });
  dropzone.addEventListener("dragover", function (event) {
    event.preventDefault();
    dropzone.classList.add("is-dragover");
  });
  dropzone.addEventListener("dragleave", function () {
    dropzone.classList.remove("is-dragover");
  });
  dropzone.addEventListener("drop", function (event) {
    event.preventDefault();
    dropzone.classList.remove("is-dragover");
    selectFile(event.dataTransfer?.files?.[0] || null);
  });
  input.addEventListener("change", function () {
    selectFile(input.files?.[0] || null);
  });
  removeButton.addEventListener("click", resetFile);

  function loadImage(source) {
    return new Promise(function (resolve, reject) {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error("A configured product image could not be loaded.")); };
      image.src = source;
    });
  }

  function canvasBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error("The preview image could not be prepared."));
      }, type, quality);
    });
  }

  async function captureConfiguredBed() {
    const stageRect = previewStage.getBoundingClientRect();
    if (!stageRect.width || !stageRect.height) {
      throw new Error("The configured bed preview is not available yet.");
    }

    const scale = Math.min(2, 1400 / stageRect.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(stageRect.width * scale));
    canvas.height = Math.max(1, Math.round(stageRect.height * scale));
    const context = canvas.getContext("2d");
    const layers = Array.from(previewStage.querySelectorAll("img")).filter(function (layer) {
      const style = getComputedStyle(layer);
      const rect = layer.getBoundingClientRect();
      return layer.src && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
    });

    for (const layer of layers) {
      const rect = layer.getBoundingClientRect();
      const image = await loadImage(layer.currentSrc || layer.src);
      context.globalAlpha = Number(getComputedStyle(layer).opacity) || 1;
      context.drawImage(
        image,
        (rect.left - stageRect.left) * scale,
        (rect.top - stageRect.top) * scale,
        rect.width * scale,
        rect.height * scale
      );
    }

    context.globalAlpha = 1;
    return canvasBlob(canvas, "image/png", 1);
  }

  async function buildRoomComposite(roomFile, bedBlob) {
    const roomUrl = URL.createObjectURL(roomFile);
    const bedUrl = URL.createObjectURL(bedBlob);

    try {
      const room = await loadImage(roomUrl);
      const bed = await loadImage(bedUrl);
      const maxEdge = 1536;
      const roomScale = Math.min(1, maxEdge / Math.max(room.naturalWidth, room.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(room.naturalWidth * roomScale));
      canvas.height = Math.max(1, Math.round(room.naturalHeight * roomScale));
      const context = canvas.getContext("2d");
      context.drawImage(room, 0, 0, canvas.width, canvas.height);

      const targetWidth = canvas.width * 0.58;
      const targetHeight = targetWidth * (bed.naturalHeight / bed.naturalWidth);
      const constrainedHeight = Math.min(targetHeight, canvas.height * 0.82);
      const constrainedWidth = constrainedHeight * (bed.naturalWidth / bed.naturalHeight);
      const x = (canvas.width - constrainedWidth) / 2;
      const y = canvas.height - constrainedHeight - canvas.height * 0.035;

      context.drawImage(bed, x, y, constrainedWidth, constrainedHeight);
      return canvasBlob(canvas, "image/jpeg", 0.9);
    } finally {
      URL.revokeObjectURL(roomUrl);
      URL.revokeObjectURL(bedUrl);
    }
  }

  function value(id, fallback) {
    return String(builderRoot.querySelector(`#${id}`)?.value || fallback || "").trim();
  }

  async function generatePreview() {
    if (!selectedFile) {
      setMessage("Please upload a room photo first.", "error");
      return;
    }
    if (!endpointOrigin || !/^https:\/\//i.test(endpointOrigin)) {
      setMessage("The room visualizer is not connected yet. Please contact the store team.", "error");
      return;
    }
    if (generationCount() >= MAX_GENERATIONS) {
      setMessage("You have used both room previews for this visit.", "error");
      generateButton.disabled = true;
      return;
    }

    activeRequest?.abort();
    activeRequest = new AbortController();
    setBusy(true);
    clearResult();
    setMessage("Preparing your configured bed and generating the room preview…", "neutral");

    try {
      const bedBlob = await captureConfiguredBed();
      const compositeBlob = await buildRoomComposite(selectedFile, bedBlob);
      const formData = new FormData();
      formData.append("image", compositeBlob, "room-with-configured-bed.jpg");
      formData.append("size", value("size-field"));
      formData.append("doorStyle", value("door-field"));
      formData.append("crown", value("crown-field"));
      formData.append("finish", value("color-field", value("finish-field")));
      formData.append("leftCabinet", value("left-side-field", "None"));
      formData.append("rightCabinet", value("right-side-field", "None"));

      const response = await fetch(`${endpointOrigin}/api/generate-room-preview`, {
        method: "POST",
        body: formData,
        signal: activeRequest.signal
      });

      if (!response.ok) {
        let errorMessage = "The room preview could not be generated.";
        try {
          const payload = await response.json();
          if (payload?.error) errorMessage = payload.error;
        } catch (error) {}
        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error("The service returned an invalid preview.");

      resultUrl = URL.createObjectURL(blob);
      resultImage.src = resultUrl;
      download.href = resultUrl;
      result.hidden = false;
      const nextCount = generationCount() + 1;
      setGenerationCount(nextCount);
      setMessage(`Your room preview is ready. ${MAX_GENERATIONS - nextCount} generation${MAX_GENERATIONS - nextCount === 1 ? "" : "s"} remaining this visit.`, "success");
      result.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) {
      if (error?.name === "AbortError") {
        setMessage("Generation cancelled.", "neutral");
      } else {
        console.error("Room visualizer error", error);
        setMessage(error?.message || "The room preview could not be generated. Please try again.", "error");
      }
    } finally {
      activeRequest = null;
      setBusy(false);
      if (generationCount() >= MAX_GENERATIONS) generateButton.disabled = true;
    }
  }

  generateButton.addEventListener("click", generatePreview);
  againButton.addEventListener("click", function () {
    clearResult();
    if (generationCount() >= MAX_GENERATIONS) {
      setMessage("You have used both room previews for this visit.", "error");
      generateButton.disabled = true;
      return;
    }
    generateButton.focus();
  });
}

function bootMurphyRoomVisualizer(scope) {
  window.setTimeout(function () {
    initMurphyRoomVisualizer(scope || document);
  }, 0);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () {
    bootMurphyRoomVisualizer(document);
  }, { once: true });
} else {
  bootMurphyRoomVisualizer(document);
}

document.addEventListener("shopify:section:load", function (event) {
  bootMurphyRoomVisualizer(event.target);
});
