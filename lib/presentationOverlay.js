"use strict";

const OVERLAY_MARKER = Symbol.for("evejs.moonOreAnomalies.presentationOverlay");

function buildPresentationByTemplateID(snapshots) {
  return Object.freeze(Object.fromEntries(
    Object.entries(snapshots && snapshots.templatesByFamily || {}).map(([family, row]) => [
      String(row.templateID),
      Object.freeze({ family, label: String(row.resolvedName) }),
    ]),
  ));
}

function presentInstance(instance, presentationByTemplateID) {
  if (!instance || typeof instance !== "object") return instance;
  const presentation = presentationByTemplateID[String(instance.templateID || "")];
  if (!presentation || String(instance.siteFamily || "").trim().toLowerCase() !== presentation.family) {
    return instance;
  }
  return {
    ...instance,
    dungeonNameID: null,
    metadata: {
      ...(instance.metadata || {}),
      label: presentation.label,
    },
    spawnState: {
      ...(instance.spawnState || {}),
      label: presentation.label,
    },
  };
}

function install(runtime, snapshots) {
  if (!runtime || typeof runtime !== "object") throw new Error("MOON_PRESENTATION_RUNTIME_INVALID");
  if (runtime[OVERLAY_MARKER]) throw new Error("MOON_PRESENTATION_OVERLAY_DUPLICATE");
  const presentationByTemplateID = buildPresentationByTemplateID(snapshots);
  const originals = new Map();
  const wrappers = new Map();
  const listenerWrappers = new Map();
  const readerNames = [
    "findInstanceBySiteKey",
    "getInstance",
    "getInstanceSummary",
    "listActiveInstancesBySystem",
    "listInstancesByFamily",
    "listInstancesByLifecycle",
    "listInstancesBySystem",
    "listInstancesByTemplate",
    "listUniversePersistentTerminalInstances",
  ];
  for (const name of readerNames) {
    if (typeof runtime[name] !== "function") continue;
    const original = runtime[name];
    const wrapper = function moonPresentationReader() {
      const result = original.apply(this, arguments);
      return Array.isArray(result)
        ? result.map((instance) => presentInstance(instance, presentationByTemplateID))
        : presentInstance(result, presentationByTemplateID);
    };
    originals.set(name, original);
    wrappers.set(name, wrapper);
    runtime[name] = wrapper;
  }
  if (typeof runtime.registerInstanceChangeListener === "function" &&
      typeof runtime.unregisterInstanceChangeListener === "function") {
    const originalRegister = runtime.registerInstanceChangeListener;
    const originalUnregister = runtime.unregisterInstanceChangeListener;
    function registerInstanceChangeListener(listener) {
      if (typeof listener !== "function") return originalRegister.apply(this, arguments);
      let wrapped = listenerWrappers.get(listener);
      if (!wrapped) {
        wrapped = (change) => listener({
          ...(change || {}),
          before: presentInstance(change && change.before, presentationByTemplateID),
          after: presentInstance(change && change.after, presentationByTemplateID),
        });
        listenerWrappers.set(listener, wrapped);
      }
      return originalRegister.call(this, wrapped);
    }
    function unregisterInstanceChangeListener(listener) {
      const wrapped = listenerWrappers.get(listener);
      const result = originalUnregister.call(this, wrapped || listener);
      if (wrapped) listenerWrappers.delete(listener);
      return result;
    }
    originals.set("registerInstanceChangeListener", originalRegister);
    originals.set("unregisterInstanceChangeListener", originalUnregister);
    wrappers.set("registerInstanceChangeListener", registerInstanceChangeListener);
    wrappers.set("unregisterInstanceChangeListener", unregisterInstanceChangeListener);
    runtime.registerInstanceChangeListener = registerInstanceChangeListener;
    runtime.unregisterInstanceChangeListener = unregisterInstanceChangeListener;
  }
  Object.defineProperty(runtime, OVERLAY_MARKER, { value: true, configurable: true });
  return {
    presentationByTemplateID,
    restore() {
      const originalRegister = originals.get("registerInstanceChangeListener");
      const originalUnregister = originals.get("unregisterInstanceChangeListener");
      if (originalRegister && originalUnregister) {
        for (const [listener, wrapped] of listenerWrappers) {
          originalUnregister.call(runtime, wrapped);
          originalRegister.call(runtime, listener);
        }
        listenerWrappers.clear();
      }
      for (const [name, original] of originals) {
        if (runtime[name] === wrappers.get(name)) runtime[name] = original;
      }
      delete runtime[OVERLAY_MARKER];
    },
  };
}

module.exports = {
  OVERLAY_MARKER,
  buildPresentationByTemplateID,
  install,
  presentInstance,
};
