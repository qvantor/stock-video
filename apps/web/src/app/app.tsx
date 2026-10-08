import { Route, Routes } from 'react-router-dom';
import { EditorPage } from '../pages/EditorPage';
import { ExportPage } from '../pages/ExportPage';
import { ExportSettingsPage } from '../pages/ExportSettingsPage';
import { ProjectPage } from '../pages/ProjectPage';
import { ProjectsPage } from '../pages/ProjectsPage';

function App() {
  return (
    <Routes>
      <Route path="/" element={<ProjectsPage />} />
      <Route path="/projects/:projectId" element={<ProjectPage />} />
      <Route path="/projects/:projectId/videos/:videoId" element={<EditorPage />} />
      <Route path="/projects/:projectId/export" element={<ExportPage />} />
      <Route path="/settings/export" element={<ExportSettingsPage />} />
    </Routes>
  );
}

export default App;
