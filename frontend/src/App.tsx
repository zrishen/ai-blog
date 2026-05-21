import { Sidebar } from "./components/Sidebar";
import { ChatPage } from "./pages/ChatPage";
import "./App.css";

function App() {
  return (
    <div className="app-layout">
      <Sidebar />
      <ChatPage />
    </div>
  );
}

export default App;
