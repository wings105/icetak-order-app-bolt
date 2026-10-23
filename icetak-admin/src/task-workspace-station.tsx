import {createRoot} from 'react-dom/client';
import TaskWorkspace from './pages/TaskWorkspace';
import {configureTaskStation} from './lib/taskTransport';
import './index.css';
import './task-workspace-station.css';

document.title='iCetak — Task Workspace';
const token=new URLSearchParams(window.location.hash.slice(1)).get('access')||'';
const root=createRoot(document.getElementById('task-root')!);
if(/^tw_[a-f0-9]{64}$/.test(token)){
 configureTaskStation(token);
 root.render(<main className="task-station"><TaskWorkspace/></main>);
}else root.render(<main className="task-station-invalid"><h1>Task Workspace</h1><p>Pautan ini tidak lengkap. Gunakan link khas PC trusted yang diberikan oleh owner.</p></main>);
