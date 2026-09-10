import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Download, FolderOpen, Search, Upload } from "lucide-react";
import { createSprocketBackup, exportSprocketBlueprint, importSprocketBlueprint, listSprocketProfiles, openSprocketPath, type SprocketProfile } from "../services/sprocket";
import { useAppStore } from "../store/AppStore";

export function SprocketLibraryPage() {
  const { notify, setPage } = useAppStore(); const [profiles, setProfiles] = useState<SprocketProfile[]>([]); const [query, setQuery] = useState(""); const [selected, setSelected] = useState<SprocketProfile | null>(null); const [busy, setBusy] = useState(true);
  const refresh = useCallback(async () => { setBusy(true); try { const result = await listSprocketProfiles(); setProfiles(result); setSelected((current) => result.find((item) => item.id === current?.id) ?? result[0] ?? null); } finally { setBusy(false); } }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const visible = useMemo(() => profiles.filter((profile) => `${profile.name} ${profile.faction}`.toLowerCase().includes(query.toLowerCase())), [profiles, query]);
  const run = async (action: () => Promise<unknown>, success: string) => { try { await action(); notify({ title: success, message: "Sprocket files were updated safely.", tone: "success" }); await refresh(); } catch (error) { notify({ title: "Action failed", message: String(error), tone: "error" }); } };
  return <section className="sprocket-page">
    <header className="sprocket-page-header"><div><span>SPROCKET</span><h1>My Blueprints</h1><p>Real local vehicle files from your Sprocket factions.</p></div><div><button className="mc-button" onClick={() => void openSprocketPath("blueprints")}><FolderOpen size={15}/> Folder</button><button className="mc-button" onClick={() => void run(createSprocketBackup, "Backup created")}><Archive size={15}/> Backup</button><button className="mc-button green" onClick={() => void run(importSprocketBlueprint, "Blueprint imported")}><Download size={15}/> Import</button></div></header>
    <div className="sprocket-library-layout">
      <div className="sprocket-profile-list"><label className="sprocket-search"><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vehicles and factions..." /></label>
        <div className="sprocket-profile-grid">{visible.map((profile) => <button key={profile.id} className={selected?.id === profile.id ? "is-selected" : ""} onClick={() => setSelected(profile)}><div className="blueprint-grid-mark"><span/></div><span><strong>{profile.name}</strong><small>{profile.faction}</small><em>{(profile.sizeBytes / 1024).toFixed(1)} KB</em></span></button>)}</div>
        {!busy && !visible.length && <div className="sprocket-empty"><Archive size={34}/><h2>No blueprints found</h2><p>Import a .blueprint or save a vehicle inside Sprocket.</p></div>}
      </div>
      <aside className="sprocket-profile-detail">{selected ? <><div className="blueprint-large-mark"><span/></div><span className="sprocket-kicker">{selected.faction}</span><h2>{selected.name}</h2><p className="sprocket-path">{selected.path}</p><dl><div><dt>Modified</dt><dd>{new Date(selected.modifiedAt * 1000).toLocaleString()}</dd></div><div><dt>Size</dt><dd>{(selected.sizeBytes / 1024).toFixed(1)} KB</dd></div></dl><button className="mc-button purple" onClick={() => setPage("mods")}>Open tuning workbench</button><button className="mc-button" onClick={() => void run(() => exportSprocketBlueprint(selected), "Blueprint exported")}><Upload size={15}/> Export blueprint</button></> : <div className="sprocket-empty"><Archive size={34}/><h2>Select a blueprint</h2></div>}</aside>
    </div>
  </section>;
}
