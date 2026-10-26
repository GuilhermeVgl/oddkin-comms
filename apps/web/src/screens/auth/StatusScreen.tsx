import type { ReactNode } from "react";
import { Sprite } from "../../design/Sprite";
import { ArtPanel, ArtStage, AuthLayout } from "./AuthLayout";

/** Shown while the session or the security state is still being read. */
export function StatusScreen({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <AuthLayout
      art={
        <ArtPanel
          headline={
            <>
              Um instante.
              <br />
              <em>Já abrimos.</em>
            </>
          }
        >
          <ArtStage start>
            <Sprite pose="load" scale={7} who="tela" />
          </ArtStage>
        </ArtPanel>
      }
    >
      <h1>{title}</h1>
      {children}
    </AuthLayout>
  );
}
