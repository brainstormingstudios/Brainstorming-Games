'use client';

import { Button } from '@brainstorming/ui';

export function ReloadButton({ label }: { label: string }) {
  return (
    <Button size="lg" className="mt-5" onClick={() => window.location.reload()}>
      {label}
    </Button>
  );
}
