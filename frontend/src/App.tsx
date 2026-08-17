import { Outlet, Route, Routes } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { Dashboard } from "@/pages/Dashboard";
import { DomainLanding } from "@/pages/DomainLanding";
import { ServicePage } from "@/pages/ServicePage";
import { RecordDetail } from "@/pages/RecordDetail";
import { Login } from "@/pages/Login";
import { RequireAuth } from "@/auth";

function Shell() {
  return (
    <div className="flex flex-col h-full">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route element={<Shell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/domain/:domain" element={<DomainLanding />} />
          <Route path="/service/:name" element={<ServicePage />} />
          <Route path="/service/:name/:id" element={<RecordDetail />} />
          <Route path="*" element={<div className="p-8">Not found</div>} />
        </Route>
      </Route>
    </Routes>
  );
}
