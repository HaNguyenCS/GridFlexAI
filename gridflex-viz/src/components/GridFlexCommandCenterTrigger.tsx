import clsx from "clsx";

interface Props {
  open: boolean;
  onClick: () => void;
}

export function GridFlexCommandCenterTrigger({ open, onClick }: Props) {
  return (
    <button
      type="button"
      className={clsx("gf-command-trigger", open && "gf-command-trigger-active")}
      onClick={onClick}
    >
      <span>Command</span>
    </button>
  );
}
