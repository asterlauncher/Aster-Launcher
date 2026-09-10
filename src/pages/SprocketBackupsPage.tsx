import { useCallback, useEffect, useState } from "react";
import { Archive, FolderOpen, HardDrive, Plus, RotateCcw } from "lucide-react";
import { createSprocketBackup, listSprocketBackups, openSprocketPath, restoreSprocketBackup, type SprocketBackup } from "../services/sprocket";
import { useAppStore } from "../store/AppStore";

export function SprocketBackupsPage() {
  const { notify } = useAppStore(); const [backups, setBackups] = useState<SprocketBackup[]>([]); const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => setBackups(await listSprocketBackups()), []); useEffect(() => { void refresh(); }, [refresh]);
  const create = async () => { setBusy(true); try { await createSprocketBackup(); await refresh(); notify({ title: "Sprocket backup created", message: "Blueprints, factions and game data were copied locally.", tone: "success" }); } catch (error) { notify({ title: "Backup failed", message: String(error), tone: "error" }); } finally { setBusy(false); } };
  const restore = async (backup: SprocketBackup) => { setBusy(true); try { await restoreSprocketBackup(backup.id); await refresh(); notify({ title: "Recovery point restored", message: "Aster preserved the files that existed before the restore.", tone: "success" }); } catch (error) { notify({ title: "Restore failed", message: String(error), tone: "error" }); } finally { setBusy(false); } };
  return <section className="sprocket-page"><header className="sprocket-page-header"><div><span>SPROCKET</span><h1>Recovery Vault</h1><p>Local snapshots stored by Aster. Nothing is uploaded.</p></div><div><button className="mc-button" onClick={() => void openSprocketPath("backups")}><FolderOpen size={15}/> Folder</button><button className="mc-button green" disabled={busy} onClick={() => void create()}><Plus size={15}/> New backup</button></div></header>
    <div className="sprocket-backup-list">{backups.map((backup) => <article key={backup.id}><div><Archive size={24}/></div><span><strong>{new Date(backup.createdAt * 1000).toLocaleString()}</strong><small>{backup.id}</small></span><em><HardDrive size={14}/>{formatBytes(backup.sizeBytes)}</em><button className="mc-button" disabled={busy} onClick={() => void restore(backup)}><RotateCcw size={14}/> Restore</button></article>)}</div>
    {!backups.length && <div className="sprocket-empty sprocket-empty-large"><Archive size={40}/><h2>No recovery points yet</h2><p>Create a snapshot before major blueprint or mod changes.</p></div>}
  </section>;
}
function formatBytes(bytes: number) { if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
