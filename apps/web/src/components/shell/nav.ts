import {
  CalendarDays,
  CarFront,
  Castle,
  Compass,
  Crosshair,
  Crown,
  Dices,
  Flame,
  Gem,
  Globe,
  Handshake,
  Hash,
  Heart,
  History,
  House,
  Joystick,
  MapPin,
  Medal,
  MousePointerClick,
  Plane,
  Puzzle,
  RefreshCw,
  Sparkles,
  Swords,
  Target,
  Trophy,
  Type,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  /** Key under the `nav` messages namespace. */
  key: string;
  href: string;
  icon: LucideIcon;
}

/** Top section of the sidebar. Items are added here as their features ship. */
export const PRIMARY_NAV: NavItem[] = [
  { key: 'home', href: '/', icon: House },
  { key: 'recent', href: '/recent', icon: History },
  { key: 'favourites', href: '/favourites', icon: Heart },
  { key: 'new', href: '/new', icon: Sparkles },
  { key: 'trending', href: '/trending', icon: Flame },
  { key: 'updated', href: '/updated', icon: RefreshCw },
  { key: 'originals', href: '/originals', icon: Crown },
  { key: 'multiplayer', href: '/multiplayer', icon: Users },
  { key: 'quests', href: '/quests', icon: Target },
  { key: 'leaderboards', href: '/leaderboards', icon: Trophy },
  { key: 'jams', href: '/jams', icon: CalendarDays },
  { key: 'premium', href: '/premium', icon: Gem },
];

export const TAGS_NAV: NavItem = { key: 'allTags', href: '/tags', icon: Hash };

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  action: Swords,
  adventure: Compass,
  arcade: Joystick,
  puzzle: Puzzle,
  'racing-driving': CarFront,
  shooting: Crosshair,
  sports: Medal,
  strategy: Castle,
  simulation: Plane,
  'clicker-idle': MousePointerClick,
  io: Globe,
  'card-board': Dices,
  'word-trivia': Type,
  '2-player': Handshake,
  'made-in-india': MapPin,
};

/** The four destinations pinned to the mobile tab bar; the fifth tab opens the full menu. */
export const TAB_NAV: NavItem[] = [
  { key: 'home', href: '/', icon: House },
  { key: 'trending', href: '/trending', icon: Flame },
  { key: 'new', href: '/new', icon: Sparkles },
  { key: 'recent', href: '/recent', icon: History },
];

/** Whether `path` (no locale prefix) is inside `href`. Home only matches itself. */
export function isActivePath(path: string, href: string): boolean {
  const clean = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
  const a = clean(path);
  const b = clean(href);
  return b === '/' ? a === '/' : a === b || a.startsWith(`${b}/`);
}
