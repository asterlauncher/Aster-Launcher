import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  Box,
  Crosshair,
  Download,
  FolderOpen,
  Gauge,
  Puzzle,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Wrench,
} from "lucide-react";
import {
  detectSprocket,
  importSprocketMod,
  inspectSprocketBlueprint,
  inspectSprocketWeapons,
  listSprocketMods,
  listSprocketProfiles,
  openSprocketPath,
  removeSprocketMod,
  repairSprocketRuntime,
  setSprocketModEnabled,
  updateSprocketBlueprint,
  type SprocketInstallation,
  type SprocketModFile,
  type SprocketProfile,
  type SprocketTunableField,
  type SprocketWeapon,
} from "../services/sprocket";
import { useAppStore } from "../store/AppStore";

type Tab = "mods" | "tuning";

const fieldKey = (field: SprocketTunableField) => field.pointer;

export function SprocketWorkbenchPage() {
  const { notify } = useAppStore();
  const [tab, setTab] = useState<Tab>("mods");
  const [installation, setInstallation] = useState<SprocketInstallation | null>(null);
  const [mods, setMods] = useState<SprocketModFile[]>([]);
  const [profiles, setProfiles] = useState<SprocketProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [fields, setFields] = useState<SprocketTunableField[]>([]);
  const [weapons, setWeapons] = useState<SprocketWeapon[]>([]);
  const [selectedWeaponId, setSelectedWeaponId] = useState("");
  const [savedValues, setSavedValues] = useState<Record<string, number>>({});
  const [fieldSearch, setFieldSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [loadingFields, setLoadingFields] = useState(false);
  const [savingFields, setSavingFields] = useState(false);

  const refresh = useCallback(async () => {
    const [nextInstallation, nextMods, nextProfiles] = await Promise.all([
      detectSprocket(),
      listSprocketMods(),
      listSprocketProfiles(),
    ]);
    setInstallation(nextInstallation);
    setMods(nextMods);
    setProfiles(nextProfiles);
    setProfileId((current) =>
      nextProfiles.some((item) => item.id === current) ? current : nextProfiles[0]?.id ?? "",
    );
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setFieldSearch("");
    setActiveCategory("All");
    if (!profileId) {
      setFields([]);
      setWeapons([]);
      setSavedValues({});
      return;
    }
    setLoadingFields(true);
    void Promise.all([inspectSprocketBlueprint(profileId), inspectSprocketWeapons(profileId)])
      .then(([nextFields, nextWeapons]) => {
        setFields(nextFields);
        setWeapons(nextWeapons);
        setSelectedWeaponId("");
        setSavedValues(Object.fromEntries(nextFields.map((field) => [fieldKey(field), field.value])));
      })
      .catch(() => {
        setFields([]);
        setWeapons([]);
        setSelectedWeaponId("");
        setSavedValues({});
      })
      .finally(() => setLoadingFields(false));
  }, [profileId]);

  const categories = useMemo(
    () => ["All", ...(weapons.length ? ["Weapons"] : []), ...Array.from(new Set(fields.filter((field) => !["Weapon", "Crew"].includes(field.category)).map((field) => field.category)))],
    [fields, weapons.length],
  );
  const changedFields = useMemo(
    () => fields.filter((field) => savedValues[fieldKey(field)] !== field.value),
    [fields, savedValues],
  );
  const visibleFields = useMemo(() => {
    const query = fieldSearch.trim().toLocaleLowerCase();
    return fields.filter((field) => {
      if (["Weapon", "Crew"].includes(field.category)) return false;
      const categoryMatches = activeCategory === "All" || (activeCategory !== "Weapons" && field.category === activeCategory);
      const searchMatches =
        !query || `${field.label} ${field.category} ${field.unit}`.toLocaleLowerCase().includes(query);
      return categoryMatches && searchMatches;
    });
  }, [activeCategory, fieldSearch, fields]);
  const groupedFields = useMemo(
    () =>
      visibleFields.reduce<Record<string, SprocketTunableField[]>>((groups, field) => {
        (groups[field.category] ??= []).push(field);
        return groups;
      }, {}),
    [visibleFields],
  );
  const selectedWeapon = useMemo(
    () => weapons.find((weapon) => weapon.id === selectedWeaponId) ?? null,
    [selectedWeaponId, weapons],
  );

  const execute = async (action: () => Promise<unknown>, title: string) => {
    try {
      await action();
      notify({ title, message: "The local Sprocket setup was updated.", tone: "success" });
      await refresh();
    } catch (error) {
      notify({ title: "Workbench action failed", message: String(error), tone: "error" });
    }
  };

  const updateField = (pointer: string, value: number) => {
    if (!Number.isFinite(value)) return;
    setFields((current) => current.map((field) => (field.pointer === pointer ? { ...field, value } : field)));
    setWeapons((current) => current.map((weapon) => ({
      ...weapon,
      fields: weapon.fields.map((field) => field.pointer === pointer ? { ...field, value } : field),
    })));
  };

  const resetFields = () => {
    setFields((current) =>
      current.map((field) => ({ ...field, value: savedValues[fieldKey(field)] ?? field.value })),
    );
    setWeapons((current) => current.map((weapon) => ({
      ...weapon,
      fields: weapon.fields.map((field) => ({
        ...field,
        value: savedValues[fieldKey(field)] ?? field.value,
      })),
    })));
  };

  const saveFields = async () => {
    if (!profileId || !changedFields.length) return;
    setSavingFields(true);
    try {
      await updateSprocketBlueprint(
        profileId,
        changedFields.map(({ pointer, value }) => ({ pointer, value })),
      );
      setSavedValues(Object.fromEntries(fields.map((field) => [fieldKey(field), field.value])));
      notify({
        title: "Blueprint tuned",
        message: "Saved with a safety backup. Reload this vehicle in Sprocket to apply the changes.",
        tone: "success",
      });
    } catch (error) {
      notify({ title: "Tuning was not saved", message: String(error), tone: "error" });
    } finally {
      setSavingFields(false);
    }
  };

  return (
    <section className="sprocket-page">
      <header className="sprocket-page-header">
        <div>
          <span>SPROCKET</span>
          <h1>Mods & Tuning</h1>
          <p>Manage community DLL mods and edit supported blueprint values with automatic backups.</p>
        </div>
        <button className="mc-button" onClick={() => void openSprocketPath(tab === "mods" ? "mods" : "blueprints")}>
          <FolderOpen size={15} /> Open folder
        </button>
      </header>

      <nav className="sprocket-tabs">
        <button className={tab === "mods" ? "active" : ""} onClick={() => setTab("mods")}>
          <Puzzle size={17} /> Community mods
        </button>
        <button className={tab === "tuning" ? "active" : ""} onClick={() => setTab("tuning")}>
          <Gauge size={17} /> Blueprint tuning
        </button>
      </nav>

      {tab === "mods" ? (
        <div className="sprocket-workbench">
          <div className={`sprocket-loader-banner ${installation?.securityScannerAvailable ? "ready" : "missing"}`}>
            <span>
              <ShieldCheck size={22} />
              <span>
                <strong>Aster Mod Runtime</strong>
                <small>
                  {installation?.securityScannerAvailable
                    ? `Managed privately by Aster${installation.asterRuntimeVersion ? ` · ${installation.asterRuntimeVersion}` : ""}. Mods are scanned on import and before launch.`
                    : "Microsoft Defender is unavailable, so Aster will block community mod imports and launches."}
                </small>
              </span>
            </span>
            <span className="sprocket-runtime-actions">
              <button className="mc-button" onClick={() => void execute(importSprocketMod, "Mod imported")}>
                <Download size={15} /> Add DLL
              </button>
              <button className="mc-icon-button" title="Repair managed runtime" onClick={() => void execute(repairSprocketRuntime, "Runtime repaired")}>
                <Wrench size={16} />
              </button>
            </span>
          </div>
          <div className="sprocket-mod-list">
            {mods.map((mod) => (
              <article key={mod.fileName}>
                <div className="sprocket-mod-icon"><Puzzle /></div>
                <div><h3>{mod.displayName}</h3><p>{mod.fileName} · {(mod.sizeBytes / 1024).toFixed(0)} KB</p></div>
                <button className={`sprocket-toggle ${mod.enabled ? "is-on" : ""}`} onClick={() => void execute(() => setSprocketModEnabled(mod.fileName, !mod.enabled), mod.enabled ? "Mod disabled" : "Mod enabled")}>
                  <span />{mod.enabled ? "ON" : "OFF"}
                </button>
                <button className="mc-icon-button danger" onClick={() => void execute(() => removeSprocketMod(mod.fileName), "Mod removed")}><Trash2 size={16} /></button>
              </article>
            ))}
          </div>
          {!mods.length && <div className="sprocket-empty"><Puzzle size={35} /><h2>No community mods installed</h2><p>Add a trusted Sprocket DLL. Aster will quarantine and scan it before installation.</p></div>}
        </div>
      ) : (
        <div className="sprocket-workbench sprocket-tuning-workbench">
          <div className="sprocket-tuning-toolbar">
            <label>
              <span>BLUEPRINT FILE</span>
              <select value={profileId} onChange={(event) => setProfileId(event.target.value)}>
                <option value="">Choose a blueprint</option>
                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.faction}</option>)}
              </select>
            </label>
            <div className="sprocket-save-actions">
              <button className="mc-button" disabled={!changedFields.length || savingFields} onClick={resetFields}><RotateCcw size={15} /> Reset</button>
              <button className="mc-button green" disabled={!changedFields.length || savingFields} onClick={() => void saveFields()}><Save size={15} /> {savingFields ? "Saving..." : `Save ${changedFields.length || ""}`}</button>
            </div>
          </div>

          {!!fields.length && (
            <>
              <div className="sprocket-reload-notice">
                <AlertTriangle size={18} />
                <div><strong>Blueprint edits are not live</strong><span>Save, then reload or reselect the vehicle in Sprocket. If the open session keeps the old blueprint cached, restart the game.</span></div>
              </div>
              <div className="sprocket-field-controls">
                <label className="sprocket-field-search"><Search size={15} /><input value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} placeholder="Search blueprint settings..." /></label>
                <span>{changedFields.length ? `${changedFields.length} unsaved` : "All changes saved"}</span>
              </div>
              <div className="sprocket-category-tabs">
                {categories.map((category) => <button key={category} className={activeCategory === category ? "active" : ""} onClick={() => { setActiveCategory(category); if (category !== "Weapons") setSelectedWeaponId(""); }}>{category}<span>{category === "All" ? fields.filter((field) => !["Weapon", "Crew"].includes(field.category)).length : category === "Weapons" ? weapons.length : fields.filter((field) => field.category === category).length}</span></button>)}
              </div>
              {activeCategory === "Weapons" ? (
                <div className="sprocket-weapon-editor">
                  {!selectedWeapon ? (
                    <div className="sprocket-weapon-list">
                      <header><div><h2>Select a cannon</h2><p>Open one named weapon to edit only that cannon and its linked loader.</p></div><Crosshair size={22} /></header>
                      <div>{weapons.map((weapon) => {
                        const hasSpeedControl = weapon.fields.some((field) => field.category === "Operator" || /reload|firing|shots/i.test(field.label));
                        return <button key={weapon.id} onClick={() => setSelectedWeaponId(weapon.id)}><span className="sprocket-weapon-icon"><Crosshair size={20} /></span><span><strong>{weapon.name}</strong><small>{weapon.operatorName ? `Operator: ${weapon.operatorName}` : "No linked loader detected"}</small></span><em>{hasSpeedControl ? "Speed controls" : `${weapon.fields.length} controls`}</em></button>;
                      })}</div>
                    </div>
                  ) : (
                    <div className="sprocket-weapon-detail">
                      <header><button className="mc-icon-button" onClick={() => setSelectedWeaponId("")}><ChevronLeft size={18} /></button><div><span>SELECTED CANNON</span><h2>{selectedWeapon.name}</h2><p><UserRound size={13} /> {selectedWeapon.operatorName ?? "No linked loader detected"}</p></div><Crosshair size={27} /></header>
                      {selectedWeapon.fields.some((field) => field.category === "Operator") && <div className="sprocket-weapon-speed-note"><Gauge size={17} /><span><strong>Reload and firing speed</strong><small>The linked loader multiplier controls how quickly this cannon completes its loading cycle. Higher values fire faster.</small></span></div>}
                      {!!selectedWeapon.fields.length ? <div className="sprocket-field-grid">{selectedWeapon.fields.map((field) => {
                        const changed = savedValues[fieldKey(field)] !== field.value;
                        return <label key={field.pointer} className={changed ? "is-changed" : ""}><span><strong>{field.label}</strong><small>{field.category === "Operator" ? "Linked crew seat" : field.category}</small></span><span className="sprocket-field-value"><input aria-label={`${field.label} value`} type="number" min={field.min} max={field.max} step={field.step} value={field.value} onChange={(event) => updateField(field.pointer, Number(event.target.value))} /><em>{field.unit}</em></span><input aria-label={`${field.label} slider`} type="range" min={field.min} max={field.max} step={field.step} value={field.value} onChange={(event) => updateField(field.pointer, Number(event.target.value))} /></label>;
                      })}</div> : <div className="sprocket-empty compact"><AlertTriangle size={28} /><h2>No linked parameters found</h2><p>The weapon name was found, but this blueprint stores its cannon data in a separate file that is not referenced here.</p></div>}
                    </div>
                  )}
                </div>
              ) : <div className="sprocket-field-sections">
                {Object.entries(groupedFields).map(([category, categoryFields]) => (
                  <section key={category}>
                    <header><h2>{category}</h2><span>{categoryFields.length} settings</span></header>
                    <div className="sprocket-field-grid">
                      {categoryFields.map((field) => {
                        const changed = savedValues[fieldKey(field)] !== field.value;
                        return (
                          <label key={field.pointer} className={changed ? "is-changed" : ""}>
                            <span><strong>{field.label}</strong><small>{field.requiresReload ? "Reload required" : "Applies live"}</small></span>
                            <span className="sprocket-field-value"><input aria-label={`${field.label} value`} type="number" min={field.min} max={field.max} step={field.step} value={field.value} onChange={(event) => updateField(field.pointer, Number(event.target.value))} /><em>{field.unit}</em></span>
                            <input aria-label={`${field.label} slider`} type="range" min={field.min} max={field.max} step={field.step} value={field.value} onChange={(event) => updateField(field.pointer, Number(event.target.value))} />
                          </label>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>}
              {activeCategory !== "Weapons" && !visibleFields.length && <div className="sprocket-empty compact"><Search size={30} /><h2>No matching settings</h2><p>Try another category or search term.</p></div>}
            </>
          )}

          {!loadingFields && !fields.length && <div className="sprocket-empty"><Box size={35} /><h2>{profileId ? "No safely editable values found" : "Choose a blueprint"}</h2><p>{profileId ? "Aster only exposes recognized numeric fields and never guesses at unknown blueprint data." : "Engine, transmission, mobility, suspension, fuel, weapon and optics values will appear here when present."}</p></div>}
        </div>
      )}
    </section>
  );
}
