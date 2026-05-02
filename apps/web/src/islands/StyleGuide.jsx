import React, { useState } from 'react';
import { mountIsland } from '@lib/island.jsx';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@ui/Card.jsx';
import { Button } from '@ui/Button.jsx';
import { Input } from '@ui/Input.jsx';
import { Select } from '@ui/Select.jsx';
import { Badge } from '@ui/Badge.jsx';
import { Avatar } from '@ui/Avatar.jsx';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@ui/Tabs.jsx';
import { Skeleton, SkeletonCard } from '@ui/Skeleton.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@ui/Dialog.jsx';
import { useToast } from '@ui/Toast.jsx';
import { DarkModeToggle } from '@ui/dark-mode.jsx';

function StyleGuide() {
  const [tab, setTab] = useState('components');
  const [open, setOpen] = useState(false);
  const toast = useToast();

  return (
    <div className="bg-bg min-h-screen">
      <div className="container max-w-6xl py-10">
        <header className="mb-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-4xl font-bold text-fg mb-2">Tokenomic Design System</h1>
            <p className="text-muted max-w-xl">Vendored shadcn-style primitives styled with Tailwind tokens (CSS custom properties). Dark by default; toggle on the right.</p>
          </div>
          <DarkModeToggle />
        </header>

        <Tabs value={tab} onValueChange={setTab} className="mb-8">
          <TabsList>
            <TabsTrigger value="components">Components</TabsTrigger>
            <TabsTrigger value="tokens">Tokens</TabsTrigger>
            <TabsTrigger value="typography">Typography</TabsTrigger>
          </TabsList>

          <TabsContent value="components">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              <Section title="Buttons">
                <div className="flex flex-wrap gap-3">
                  <Button>Primary</Button>
                  <Button variant="secondary">Secondary</Button>
                  <Button variant="outline">Outline</Button>
                  <Button variant="ghost">Ghost</Button>
                  <Button variant="danger">Danger</Button>
                  <Button variant="link">Link</Button>
                </div>
                <div className="flex flex-wrap gap-3 mt-3">
                  <Button size="sm">Small</Button>
                  <Button size="md">Medium</Button>
                  <Button size="lg">Large</Button>
                  <Button loading>Loading…</Button>
                </div>
              </Section>

              <Section title="Inputs & Select">
                <div className="space-y-3">
                  <Input placeholder="Email address" />
                  <Input placeholder="Search…" leadingIcon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>} />
                  <Select options={[{ value: 'a', label: 'Choice A' }, { value: 'b', label: 'Choice B' }]} value="a" onChange={() => {}} />
                </div>
              </Section>

              <Section title="Badges">
                <div className="flex flex-wrap gap-2">
                  <Badge>Default</Badge>
                  <Badge variant="brand">Brand</Badge>
                  <Badge variant="accent">Accent</Badge>
                  <Badge variant="success">Success</Badge>
                  <Badge variant="danger">Danger</Badge>
                  <Badge variant="outline">Outline</Badge>
                </div>
              </Section>

              <Section title="Avatars">
                <div className="flex items-center gap-3">
                  <Avatar name="Ada Lovelace" size="xs" />
                  <Avatar name="Linus Torvalds" size="sm" />
                  <Avatar name="Grace Hopper" size="md" />
                  <Avatar name="Donald Knuth" size="lg" />
                  <Avatar name="Margaret Hamilton" size="xl" />
                </div>
              </Section>

              <Section title="Cards">
                <Card hover>
                  <CardHeader>
                    <CardTitle>Smart Contract Suite</CardTitle>
                    <CardDescription>Six audited contracts on Base L2.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted">Soulbound credentials, USDC-priced course access, monthly subscriptions, on-chain revenue splits.</p>
                  </CardContent>
                </Card>
              </Section>

              <Section title="Skeletons">
                <SkeletonCard />
              </Section>

              <Section title="Dialog & Toast">
                <div className="flex flex-wrap gap-3">
                  <Button onClick={() => setOpen(true)}>Open dialog</Button>
                  <Button variant="secondary" onClick={() => toast.push({ title: 'Saved', description: 'Profile updated.', variant: 'success' })}>Show toast</Button>
                </div>
                <Dialog open={open} onOpenChange={setOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Confirm action</DialogTitle>
                      <DialogDescription>Modal example using the design-system Dialog primitive.</DialogDescription>
                    </DialogHeader>
                    <div className="text-sm text-muted">All islands hydrate in dark mode by default. The system honors `prefers-color-scheme` only when the user has not picked a theme.</div>
                    <DialogFooter>
                      <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                      <Button onClick={() => { setOpen(false); toast.push({ title: 'Confirmed', variant: 'success' }); }}>Confirm</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </Section>
            </div>
          </TabsContent>

          <TabsContent value="tokens">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {['bg', 'surface', 'surface2', 'fg', 'muted', 'border', 'brand', 'accent', 'success', 'danger'].map((name) => (
                <Card key={name}>
                  <div className={`h-20 bg-${name}`} />
                  <CardContent className="p-3">
                    <div className="font-mono text-xs text-fg">--tk-{name}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="typography">
            <Card><CardContent className="p-6 space-y-3">
              <h1 className="text-4xl font-bold text-fg">Display 4xl</h1>
              <h2 className="text-3xl font-bold text-fg">Heading 3xl</h2>
              <h3 className="text-2xl font-semibold text-fg">Subheading 2xl</h3>
              <p className="text-base text-fg">Body text uses Inter at 16px line-height-relaxed.</p>
              <p className="text-sm text-muted">Muted body for secondary information.</p>
            </CardContent></Card>
          </TabsContent>

        </Tabs>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

mountIsland('StyleGuide', StyleGuide);
export default StyleGuide;
