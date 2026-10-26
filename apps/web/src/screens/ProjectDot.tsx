import { projectColor } from "../shell/Sidebar";

/** The small coloured dot that stands for a project. */
export function ProjectDot({ color }: { color: string }) {
  return <i className="pd" style={{ background: projectColor(color) }} />;
}
