import { useEffect, useMemo, useRef, useState } from "react";
import { splitDevices } from "./callView";
import { previewConstraints } from "./media";
import { useMicLevels } from "./useMicLevels";

const METER_BARS = 12;

/**
 * Camera and microphone preview with device selection, before joining. The
 * preview only runs while `active`; leaving it stops every track.
 */
export function usePrejoin(
  active: boolean,
  onError: (message: string) => void,
) {
  const [withCamera, setWithCamera] = useState(true);
  const [withMic, setWithMic] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [microphoneId, setMicrophoneId] = useState("");
  const [cameraId, setCameraId] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const levels = useMicLevels(withMic ? stream : null, METER_BARS);

  useEffect(() => {
    if (!active) return undefined;
    let opened: MediaStream | null = null;
    let live = true;
    navigator.mediaDevices
      .getUserMedia(previewConstraints({ microphoneId, cameraId }, withCamera))
      .then(async (value) => {
        if (!live) {
          value.getTracks().forEach((track) => track.stop());
          return;
        }
        opened = value;
        setStream(value);
        if (preview.current !== null) preview.current.srcObject = value;
        setDevices(await navigator.mediaDevices.enumerateDevices());
      })
      .catch(() =>
        onError(
          "Não foi possível acessar câmera ou microfone. Você pode entrar sem câmera.",
        ),
      );
    return () => {
      live = false;
      opened?.getTracks().forEach((track) => track.stop());
      setStream(null);
    };
  }, [active, withCamera, microphoneId, cameraId]);

  const { microphones, cameras } = useMemo(
    () => splitDevices(devices),
    [devices],
  );

  return {
    preview,
    stream,
    levels,
    withCamera,
    toggleCamera: () => setWithCamera((value) => !value),
    withMic,
    toggleMic: () => setWithMic((value) => !value),
    microphones,
    cameras,
    microphoneId,
    setMicrophoneId,
    cameraId,
    setCameraId,
  };
}

export type Prejoin = ReturnType<typeof usePrejoin>;
