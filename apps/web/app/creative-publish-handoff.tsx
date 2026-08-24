import { LoaderCircle, Send } from "lucide-react";

export function CreativePublishHandoff({ description, busy, disabled, busyLabel, onCreate }: { description: string; busy: boolean; disabled: boolean; busyLabel: string; onCreate: () => void }) {
  return <section className="slideshow-publish slideshow-handoff">
    <p className="eyebrow">Publish</p>
    <h3>Finish in Create Post</h3>
    <p>{description}</p>
    <button className="primary-button" disabled={disabled} onClick={onCreate}>{busy ? <LoaderCircle className="spin" /> : <Send />}{busy ? busyLabel : "Create post"}</button>
  </section>;
}
