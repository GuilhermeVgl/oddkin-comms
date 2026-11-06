/** A labelled browser-media device picker shared by preview and live calls. */
export function DeviceSelect({
  id,
  label,
  fallback,
  devices,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  fallback: string;
  devices: readonly MediaDeviceInfo[];
  value: string;
  disabled?: boolean;
  onChange: (deviceId: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        className="inp"
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="">Padrão do navegador</option>
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || fallback}
          </option>
        ))}
      </select>
    </div>
  );
}
