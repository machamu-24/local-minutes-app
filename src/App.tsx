import { Route, Switch } from "wouter";
import { Toaster } from "sonner";
import RecordingList from "@/pages/RecordingList";
import RecordingDetail from "@/pages/RecordingDetail";
import Setup from "@/pages/Setup";

export default function App() {
  return (
    <>
      <Switch>
        <Route path="/setup" component={Setup} />
        <Route path="/recordings/:id" component={RecordingDetail} />
        <Route path="/" component={RecordingList} />
      </Switch>
      <Toaster richColors position="top-right" />
    </>
  );
}
