import type { DeviceFrame } from "@relay/core";
import { AppWindow, Smartphone, Tablet } from "lucide-react";
import { defaultDeviceFrame, deviceFrameGeometry, deviceFrameSvg } from "../lib/device-frames";

type DeviceChoice = DeviceFrame["device"] | "none";

const choices: Array<{ value: DeviceChoice; label: string; icon?: typeof Smartphone }> = [
  { value: "none", label: "None" },
  { value: "phone", label: "Phone", icon: Smartphone },
  { value: "tablet", label: "Tablet", icon: Tablet },
  { value: "browser", label: "Browser", icon: AppWindow },
];

export function DeviceFrameControls({
  value,
  disabled = false,
  onChange,
}: {
  value?: DeviceFrame;
  disabled?: boolean;
  onChange: (value: DeviceFrame | undefined) => void;
}) {
  const select = (device: DeviceChoice) => {
    if (device === "none") {
      onChange(undefined);
      return;
    }
    onChange({ ...(value ?? defaultDeviceFrame), device });
  };

  return (
    <div className="device-frame-controls" data-testid="device-frame-controls">
      <div className="device-frame-options" role="group" aria-label="Device frame">
        {choices.map((choice) => {
          const Icon = choice.icon;
          const selected = (value?.device ?? "none") === choice.value;
          return (
            <button
              key={choice.value}
              type="button"
              disabled={disabled}
              className={selected ? "active" : ""}
              aria-pressed={selected}
              data-device-frame={choice.value}
              onClick={() => select(choice.value)}
            >
              {Icon ? <Icon aria-hidden="true" /> : <span aria-hidden="true" className="device-frame-none" />}
              {choice.label}
            </button>
          );
        })}
      </div>
      {value && (
        <div className="device-frame-colors">
          <label>
            <input
              aria-label="Device background color"
              type="color"
              value={value.background}
              disabled={disabled}
              onChange={(event) => onChange({ ...value, background: event.target.value.toUpperCase() })}
            />
            <span>Background</span>
            <small>{value.background}</small>
          </label>
          <label>
            <input
              aria-label="Device frame color"
              type="color"
              value={value.color}
              disabled={disabled}
              onChange={(event) => onChange({ ...value, color: event.target.value.toUpperCase() })}
            />
            <span>Frame</span>
            <small>{value.color}</small>
          </label>
        </div>
      )}
    </div>
  );
}

const percent = (value: number, total: number) => `${value / total * 100}%`;

export function DeviceFramePreview({
  value,
  width,
  height,
  children,
}: {
  value?: DeviceFrame;
  width: number;
  height: number;
  children: React.ReactNode;
}) {
  const geometry = value ? deviceFrameGeometry(width, height, value.device) : undefined;
  const screenStyle = geometry ? {
    left: percent(geometry.screen.x, width),
    top: percent(geometry.screen.y, height),
    width: percent(geometry.screen.width, width),
    height: percent(geometry.screen.height, height),
    borderRadius: `${percent(geometry.screen.radius, geometry.screen.width)} / ${percent(geometry.screen.radius, geometry.screen.height)}`,
  } as React.CSSProperties : undefined;
  const overlay = value ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(deviceFrameSvg(width, height, value))}` : undefined;

  return (
    <div className={`device-frame-preview ${value?.device ?? "none"}`} style={{ backgroundColor: value?.background }} data-device-preview={value?.device ?? "none"}>
      <div className="device-frame-screen" style={screenStyle}>{children}</div>
      {overlay && <img className="device-frame-overlay" src={overlay} alt="" aria-hidden="true" />}
    </div>
  );
}
