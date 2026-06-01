import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

// ---------- types ----------

type Mode = 'tourist' | 'guide';

type Category = 'history' | 'food' | 'nature' | 'art' | 'nightlife' | 'family';

type Tour = {
  id: string;
  guideId: string; // 'me' for user-created tours
  guideName: string;
  guideAvatar: string;
  guideRating: number; // 0..5
  guideReviewCount: number;
  title: string;
  city: string;
  country: string;
  description: string;
  meetingPoint: string;
  durationMin: number;
  languages: string[];
  category: Category;
  cover: string; // emoji
  coverColor: string; // hex
  schedule: string[]; // legacy weekly pattern, shown in the detail view
  availableSlots: { date: string; time: string }[]; // specific YYYY-MM-DD + HH:MM the guide has opened
  itinerary: { title: string; note?: string }[]; // ordered stops the walk covers
  bookingCount?: number; // seeded historical count; user-created tours derive theirs live
  isUserCreated?: boolean;
};

type BookingStatus = 'pending' | 'confirmed' | 'declined' | 'completed';

type Booking = {
  id: string;
  tourId: string;
  // snapshot of tour at booking time so the listing can change without
  // breaking historical entries
  tourTitle: string;
  tourCity: string;
  tourCover: string;
  tourCoverColor: string;
  guideName: string;
  partySize: number;
  date: string; // 'YYYY-MM-DD'
  time: string; // 'HH:MM'
  note: string;
  status: BookingStatus;
  bookedAt: number;
  // who booked this; 'me' when the user (as tourist) booked someone else's
  // tour; 'sim:NAME' when a simulated tourist booked the user's tour.
  fromUserId: string;
  fromName: string;
  fromAvatar: string;
};

type Profile = {
  name: string;
  bio: string;
  city: string;
  avatar: string; // emoji
  languages: string[];
};

// ---------- constants ----------

const STORAGE_KEYS = {
  mode: 'strollmap:mode:v1',
  profile: 'strollmap:profile:v1',
  myTours: 'strollmap:myTours:v1',
  myBookings: 'strollmap:myBookings:v1',
  inbox: 'strollmap:inbox:v1',
  onboarded: 'strollmap:onboarded:v1',
  haptics: 'strollmap:haptics:v1',
};

const COVER_PALETTE = [
  '#e36b3a', '#3a7ba9', '#6a9a4f', '#c79a3a', '#a04f8a',
  '#3a9a8a', '#c75050', '#7a6b9a', '#d68a3a', '#5a8aa9',
];

const COVER_EMOJI = ['🌆', '🍷', '🎨', '🗺️', '🏛️', '🌃', '🥐', '🌮', '🍜', '🌺', '🎭', '⛵'];

const LANGUAGES_OPTIONS = ['English', 'Spanish', 'French', 'Japanese', 'Portuguese', 'German', 'Thai', 'Italian', 'Mandarin'];

const CATEGORIES: { id: Category; label: string; emoji: string }[] = [
  { id: 'history',   label: 'History',   emoji: '🏛️' },
  { id: 'food',      label: 'Food',      emoji: '🥐' },
  { id: 'art',       label: 'Art',       emoji: '🎨' },
  { id: 'nature',    label: 'Nature',    emoji: '🌿' },
  { id: 'nightlife', label: 'Nightlife', emoji: '🌃' },
  { id: 'family',    label: 'Family',    emoji: '🧒' },
];

// ---------- seed ----------

const seedSlots = (offsets: number[], times: string[]): { date: string; time: string }[] => {
  const out: { date: string; time: string }[] = [];
  for (let i = 0; i < offsets.length; i++) out.push({ date: todayPlus(offsets[i]), time: times[i % times.length] });
  return out;
};

const SEEDED_TOURS: Tour[] = [
  {
    id: 'seed-1', guideId: 'g1', guideName: 'Marisol Reyes', guideAvatar: '👩🏽‍🦱',
    guideRating: 4.9, guideReviewCount: 312,
    title: 'Coyoacán: Frida, color, and cantinas',
    city: 'Mexico City', country: 'Mexico',
    description: "A two-and-a-half-hour stroll through Frida Kahlo's neighborhood — cobbled streets, the artisan market, the church plaza, and one of the city's oldest cantinas where I'll buy the first round of horchata.",
    meetingPoint: 'Coyoacán metro exit, by the orange churro stand',
    durationMin: 150, languages: ['Spanish', 'English'], category: 'history',
    cover: '🌺', coverColor: '#c75050',
    schedule: ['Tue 10:00', 'Thu 16:00', 'Sat 10:00'],
    availableSlots: seedSlots([2, 4, 6, 9], ['10:00', '16:00', '10:00', '10:00']),
    bookingCount: 412,
    itinerary: [
      { title: 'Coyoacán metro & churro stand', note: 'Meet, grab a churro, head south.' },
      { title: 'Jardín Centenario', note: 'The two coyote fountains and a quick history.' },
      { title: "Frida Kahlo's neighborhood block" },
      { title: 'Mercado de Coyoacán', note: 'Tostadas if anyone is hungry.' },
      { title: 'La Coyoacana cantina', note: 'Round of horchata on me.' },
    ],
  },
  {
    id: 'seed-2', guideId: 'g2', guideName: 'Akira Tanaka', guideAvatar: '👨🏻‍🦰',
    guideRating: 4.8, guideReviewCount: 187,
    title: 'Shibuya by night: alleys, neon, izakayas',
    city: 'Tokyo', country: 'Japan',
    description: 'We start at the Hachikō statue, cross the scramble together, then duck into the side alleys most tourists miss — a tiny standing-bar district, a shrine glowing under a vending-machine wall, and a soup-curry counter that seats eight.',
    meetingPoint: 'Hachikō exit, Shibuya station',
    durationMin: 180, languages: ['English', 'Japanese'], category: 'nightlife',
    cover: '🌃', coverColor: '#3a7ba9',
    schedule: ['Wed 19:00', 'Fri 19:00', 'Sat 19:30'],
    availableSlots: seedSlots([3, 5, 7, 10], ['19:00', '19:00', '19:30', '19:00']),
    bookingCount: 254,
    itinerary: [
      { title: 'Hachikō statue', note: 'Meet here, story of the dog.' },
      { title: 'Shibuya scramble crossing', note: 'We cross together, hold your phone tight.' },
      { title: 'Nonbei Yokocho', note: 'Drinker\'s alley — eight stools each.' },
      { title: 'A neon-lit hidden shrine' },
      { title: 'Soup curry counter', note: '8-seat counter, soup at the end.' },
    ],
  },
  {
    id: 'seed-3', guideId: 'g3', guideName: 'Léa Dubois', guideAvatar: '👩🏼',
    guideRating: 4.95, guideReviewCount: 421,
    title: 'Marais food crawl: cheese, bread, three bakeries',
    city: 'Paris', country: 'France',
    description: 'Tasting walk through the Marais. Five small stops: a fromagerie my neighbor runs, two boulangeries with different croissant philosophies, a falafel stand with a forty-minute line we will skip, and a wine bar for one glass.',
    meetingPoint: 'Saint-Paul métro, top of the stairs',
    durationMin: 165, languages: ['French', 'English'], category: 'food',
    cover: '🥐', coverColor: '#d68a3a',
    schedule: ['Mon 11:00', 'Wed 11:00', 'Sat 11:00'],
    availableSlots: seedSlots([2, 4, 6, 9], ['11:00', '11:00', '11:00', '11:00']),
    bookingCount: 538,
    itinerary: [
      { title: 'Saint-Paul métro', note: 'Meet at the top of the stairs.' },
      { title: 'Fromagerie chez Antoine', note: 'My neighbor. Three cheeses.' },
      { title: 'Boulangerie A — the buttery one' },
      { title: 'Boulangerie B — the flakey one', note: 'Compare technique.' },
      { title: "Falafel stand we skip the line at" },
      { title: 'Wine bar on rue Vieille du Temple', note: 'One glass to finish.' },
    ],
  },
  {
    id: 'seed-4', guideId: 'g4', guideName: 'João Almeida', guideAvatar: '👨🏽',
    guideRating: 4.85, guideReviewCount: 156,
    title: 'Tiles, tagus, tilework: Alfama street art',
    city: 'Lisbon', country: 'Portugal',
    description: "Alfama is the oldest neighborhood in Lisbon and you can read its history off the walls. We'll trace traditional azulejo tilework against modern street art, then climb to a miradouro for the view over the Tagus.",
    meetingPoint: 'Largo do Chafariz de Dentro, by the fountain',
    durationMin: 135, languages: ['Portuguese', 'English', 'Spanish'], category: 'art',
    cover: '🎨', coverColor: '#a04f8a',
    schedule: ['Tue 09:30', 'Thu 09:30', 'Sun 09:30'],
    availableSlots: seedSlots([3, 5, 8, 12], ['09:30', '09:30', '09:30', '09:30']),
    bookingCount: 201,
    itinerary: [
      { title: 'Largo do Chafariz fountain' },
      { title: 'Casa dos Bicos & azulejo wall', note: 'The classic and the modern next to each other.' },
      { title: 'Beco do Maldonado street art', note: 'A whole alley of new pieces.' },
      { title: 'São Vicente de Fora panorama' },
      { title: 'Miradouro da Senhora do Monte', note: 'The view that justifies the climb.' },
    ],
  },
  {
    id: 'seed-5', guideId: 'g5', guideName: 'Lukas Becker', guideAvatar: '👨🏼‍🦱',
    guideRating: 4.7, guideReviewCount: 98,
    title: 'East Side Gallery and the wall, end to end',
    city: 'Berlin', country: 'Germany',
    description: 'We walk the entire length of the East Side Gallery — the longest open-air section of the Berlin Wall — and I tell the story behind the murals I grew up around. Two hours, easy pace.',
    meetingPoint: 'Ostbahnhof, Mühlenstraße exit',
    durationMin: 120, languages: ['German', 'English'], category: 'history',
    cover: '🗺️', coverColor: '#7a6b9a',
    schedule: ['Mon 14:00', 'Wed 14:00', 'Sat 14:00'],
    availableSlots: seedSlots([2, 4, 7, 11], ['14:00', '14:00', '14:00', '14:00']),
    bookingCount: 126,
    itinerary: [
      { title: 'Ostbahnhof — wall context', note: 'Five minutes on what this was.' },
      { title: 'Trabant mural', note: "Kani's car, you'll know it." },
      { title: 'Brotherly kiss section', note: 'The most photographed mural.' },
      { title: 'Oberbaumbrücke views', note: 'Best photo of the river.' },
      { title: 'End of the gallery, debrief' },
    ],
  },
  {
    id: 'seed-6', guideId: 'g6', guideName: 'Ploy Suthep', guideAvatar: '👩🏻',
    guideRating: 4.9, guideReviewCount: 263,
    title: 'Six street-food stops in Chinatown',
    city: 'Bangkok', country: 'Thailand',
    description: "A walking tasting through Yaowarat. Six stops: noodles, oysters, dim sum, mango sticky rice, a strange green dessert I'll explain when we get there, and the best Hokkien noodles in Bangkok according to my grandmother.",
    meetingPoint: 'Wat Mangkon MRT, exit 1',
    durationMin: 195, languages: ['Thai', 'English'], category: 'food',
    cover: '🍜', coverColor: '#e36b3a',
    schedule: ['Tue 17:30', 'Fri 17:30', 'Sun 17:30'],
    availableSlots: seedSlots([2, 5, 7, 10], ['17:30', '17:30', '17:30', '17:30']),
    bookingCount: 347,
    itinerary: [
      { title: 'Wat Mangkon MRT, exit 1' },
      { title: "Nai Mong Hoy Tod — oyster omelette" },
      { title: 'Dim sum stall on Phadungdao' },
      { title: 'Mango sticky rice (the original)' },
      { title: 'The strange green dessert', note: "I'll explain when we get there." },
      { title: "Grandma's Hokkien noodles" },
    ],
  },
  {
    id: 'seed-7', guideId: 'g7', guideName: 'Sofía Romano', guideAvatar: '👩🏻‍🦱',
    guideRating: 4.6, guideReviewCount: 74,
    title: 'San Telmo Sunday: antiques and tango',
    city: 'Buenos Aires', country: 'Argentina',
    description: "Sundays in San Telmo are when the antique fair takes over Defensa street for ten blocks. We'll wander it, stop at a milonga where retirees dance tango at noon, and end with a coffee at the oldest café in the neighborhood.",
    meetingPoint: 'Plaza Dorrego center',
    durationMin: 150, languages: ['Spanish', 'English'], category: 'family',
    cover: '🎭', coverColor: '#5a8aa9',
    schedule: ['Sun 11:00'],
    availableSlots: seedSlots([4, 11, 18], ['11:00', '11:00', '11:00']),
    bookingCount: 92,
    itinerary: [
      { title: 'Plaza Dorrego — meet at the center fountain' },
      { title: 'Antique stalls down Defensa', note: 'Ten blocks of stalls every Sunday.' },
      { title: 'Milonga at noon', note: 'Watch retirees dance tango.' },
      { title: 'Café Tortoni', note: 'The oldest café in the city.' },
    ],
  },
  {
    id: 'seed-8', guideId: 'g8', guideName: 'Aila Lindgren', guideAvatar: '👱🏻‍♀️',
    guideRating: 4.95, guideReviewCount: 188,
    title: 'High Line + Hudson Yards architecture walk',
    city: 'New York', country: 'United States',
    description: "Start at Gansevoort, walk the High Line slowly, and notice the buildings most people glide past. We'll stop at three contemporary works (Diller Scofidio, Heatherwick, BIG) and end with a free skybridge view nobody knows about.",
    meetingPoint: 'Gansevoort Street entrance, by the elevator',
    durationMin: 165, languages: ['English'], category: 'art',
    cover: '🏛️', coverColor: '#3a9a8a',
    schedule: ['Tue 10:00', 'Fri 10:00', 'Sat 10:30'],
    availableSlots: seedSlots([3, 6, 8, 13], ['10:00', '10:00', '10:30', '10:00']),
    bookingCount: 248,
    itinerary: [
      { title: 'Gansevoort Street entrance', note: 'Meet at the elevator.' },
      { title: 'Diller Scofidio building stop' },
      { title: 'Hudson Yards & the Vessel', note: 'View, not entry.' },
      { title: "Heatherwick's complicated piece" },
      { title: 'The free skybridge most people miss', note: 'My favorite ending.' },
    ],
  },
];

const SIM_TOURIST_NAMES = [
  { name: 'Hana Mori',     avatar: '🧑🏻' },
  { name: 'Tomás Vidal',   avatar: '🧑🏽‍🦱' },
  { name: 'Priya Iyer',    avatar: '👩🏽' },
  { name: 'Wei Chen',      avatar: '👨🏻' },
  { name: 'Nora Halvorsen', avatar: '👩🏼‍🦰' },
  { name: 'Yusuf Kaya',    avatar: '👨🏽' },
];

const DEFAULT_PROFILE: Profile = {
  name: 'Alex',
  bio: '',
  city: '',
  avatar: '🙂',
  languages: ['English'],
};

// ---------- helpers ----------

function rid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function todayPlus(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseTime(s: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function formatDate(s: string): string {
  const d = parseDate(s);
  if (!d) return s;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------- app ----------

export default function App() {
  // mode + tabs
  const [mode, setMode] = useState<Mode>('tourist');
  const [touristTab, setTouristTab] = useState<'browse' | 'bookings' | 'profile'>('browse');
  const [guideTab, setGuideTab] = useState<'tours' | 'inbox' | 'profile'>('tours');

  // data
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [myTours, setMyTours] = useState<Tour[]>([]);
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [inbox, setInbox] = useState<Booking[]>([]);
  const [haptics, setHaptics] = useState(true);
  const [loaded, setLoaded] = useState(false);

  // UI state
  const [browseCity, setBrowseCity] = useState<string | null>(null);
  const [browseCategory, setBrowseCategory] = useState<Category | null>(null);
  const [selectedTour, setSelectedTour] = useState<Tour | null>(null);
  const [bookingDraft, setBookingDraft] = useState<null | {
    tour: Tour; date: string; time: string; party: number; note: string;
  }>(null);
  const [editingBooking, setEditingBooking] = useState<null | {
    booking: Booking; tour: Tour | null; date: string; time: string; party: number; note: string;
  }>(null);
  const [tourEditor, setTourEditor] = useState<null | { mode: 'create' | 'edit'; draft: Tour }>(null);

  // ---------- load / save ----------

  useEffect(() => {
    (async () => {
      try {
        const [m, p, t, b, i, h, ob] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.mode),
          AsyncStorage.getItem(STORAGE_KEYS.profile),
          AsyncStorage.getItem(STORAGE_KEYS.myTours),
          AsyncStorage.getItem(STORAGE_KEYS.myBookings),
          AsyncStorage.getItem(STORAGE_KEYS.inbox),
          AsyncStorage.getItem(STORAGE_KEYS.haptics),
          AsyncStorage.getItem(STORAGE_KEYS.onboarded),
        ]);
        if (m === 'tourist' || m === 'guide') setMode(m);
        if (p) setProfile({ ...DEFAULT_PROFILE, ...JSON.parse(p) });
        if (t) setMyTours(JSON.parse(t));
        if (b) setMyBookings(JSON.parse(b));
        if (i) setInbox(JSON.parse(i));
        if (h === 'true' || h === 'false') setHaptics(h === 'true');
        // First-launch seed: nothing to add for tourist mode (seeded tours
        // live in code). Just mark onboarded so we don't repeat work.
        if (!ob) await AsyncStorage.setItem(STORAGE_KEYS.onboarded, 'true');
      } catch {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.mode, mode).catch(() => {});
  }, [mode, loaded]);
  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(profile)).catch(() => {});
  }, [profile, loaded]);
  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.myTours, JSON.stringify(myTours)).catch(() => {});
  }, [myTours, loaded]);
  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.myBookings, JSON.stringify(myBookings)).catch(() => {});
  }, [myBookings, loaded]);
  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.inbox, JSON.stringify(inbox)).catch(() => {});
  }, [inbox, loaded]);
  useEffect(() => {
    if (!loaded) return;
    AsyncStorage.setItem(STORAGE_KEYS.haptics, String(haptics)).catch(() => {});
  }, [haptics, loaded]);

  // ---------- haptics ----------

  const tap = useCallback((kind: 'light' | 'medium' | 'success' | 'warning' = 'light') => {
    if (!haptics) return;
    if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else if (kind === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    else if (kind === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    else Haptics.selectionAsync().catch(() => {});
  }, [haptics]);

  // ---------- derived ----------

  const allTours: Tour[] = useMemo(() => {
    // User's published tours appear in browse too, so a creator can see
    // their own listing alongside the seeded ones.
    return [...myTours, ...SEEDED_TOURS];
  }, [myTours]);

  // Live booking count per tour: seeded number for catalog tours,
  // inbox + myBookings count for user-created ones.
  const bookingCountFor = useCallback((t: Tour) => {
    if (!t.isUserCreated) return t.bookingCount ?? 0;
    const fromInbox = inbox.filter((b) => b.tourId === t.id).length;
    return fromInbox;
  }, [inbox]);

  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTours) set.add(t.city);
    return Array.from(set).sort();
  }, [allTours]);

  const visibleTours = useMemo(() => {
    return allTours.filter((t) => {
      if (browseCity && t.city !== browseCity) return false;
      if (browseCategory && t.category !== browseCategory) return false;
      return true;
    });
  }, [allTours, browseCity, browseCategory]);

  const upcomingBookings = useMemo(() => myBookings.filter((b) => b.status === 'pending' || b.status === 'confirmed'), [myBookings]);
  const pastBookings = useMemo(() => myBookings.filter((b) => b.status === 'completed' || b.status === 'declined'), [myBookings]);
  const pendingInbox = useMemo(() => inbox.filter((b) => b.status === 'pending'), [inbox]);
  const handledInbox = useMemo(() => inbox.filter((b) => b.status !== 'pending'), [inbox]);

  // ---------- actions ----------

  const openTour = useCallback((t: Tour) => { tap('light'); setSelectedTour(t); }, [tap]);
  const closeTour = useCallback(() => setSelectedTour(null), []);

  const beginBooking = useCallback((t: Tour) => {
    // Close the tour detail first — on iOS, a transparent Modal can't
    // render on top of a presentationStyle="pageSheet" Modal.
    setSelectedTour(null);
    const first = t.availableSlots[0];
    setBookingDraft({
      tour: t,
      date: first?.date ?? todayPlus(2),
      time: first?.time ?? '10:00',
      party: 1,
      note: '',
    });
  }, []);

  const confirmBooking = useCallback(() => {
    if (!bookingDraft) return;
    const d = parseDate(bookingDraft.date);
    const ti = parseTime(bookingDraft.time);
    if (!d) { Alert.alert('Pick a valid date', 'Format: YYYY-MM-DD, e.g. ' + todayPlus(3)); return; }
    if (!ti) { Alert.alert('Pick a valid time', 'Format: HH:MM, 24-hour, e.g. 10:30'); return; }
    if (bookingDraft.party < 1 || bookingDraft.party > 20) {
      Alert.alert('Party size', 'Between 1 and 20 people.'); return;
    }
    const t = bookingDraft.tour;
    const b: Booking = {
      id: rid(),
      tourId: t.id,
      tourTitle: t.title,
      tourCity: t.city,
      tourCover: t.cover,
      tourCoverColor: t.coverColor,
      guideName: t.guideName,
      partySize: bookingDraft.party,
      date: bookingDraft.date,
      time: bookingDraft.time,
      note: bookingDraft.note,
      status: 'pending',
      bookedAt: Date.now(),
      fromUserId: 'me',
      fromName: profile.name,
      fromAvatar: profile.avatar,
    };
    setMyBookings((prev) => [b, ...prev]);
    if (t.guideId === 'me') {
      // Tourist booked one of the user's OWN tours — also drop it in
      // their guide inbox so they can confirm it from the other side.
      setInbox((prev) => [{ ...b }, ...prev]);
    } else {
      // Simulate the other guide auto-confirming after a short delay, so
      // the tourist sees status move from pending → confirmed.
      setTimeout(() => {
        setMyBookings((prev) =>
          prev.map((x) => (x.id === b.id ? { ...x, status: 'confirmed' as BookingStatus } : x)),
        );
      }, 2200);
    }
    setBookingDraft(null);
    setSelectedTour(null);
    tap('success');
    Alert.alert('Request sent', `${t.guideName} will get back to you shortly.\n\n(Demo: this app simulates a confirmation, but in a real build it would notify the guide.)`);
  }, [bookingDraft, profile, tap]);

  // GUIDE-side actions

  const beginCreateTour = useCallback(() => {
    const draft: Tour = {
      id: rid(),
      guideId: 'me',
      guideName: profile.name || 'You',
      guideAvatar: profile.avatar,
      guideRating: 5.0,
      guideReviewCount: 0,
      title: '',
      city: profile.city || '',
      country: '',
      description: '',
      meetingPoint: '',
      durationMin: 90,
      languages: profile.languages,
      category: 'history',
      cover: COVER_EMOJI[Math.floor(Math.random() * COVER_EMOJI.length)],
      coverColor: COVER_PALETTE[Math.floor(Math.random() * COVER_PALETTE.length)],
      schedule: [],
      availableSlots: [
        { date: todayPlus(7), time: '10:00' },
        { date: todayPlus(14), time: '10:00' },
      ],
      itinerary: [],
      isUserCreated: true,
    };
    setTourEditor({ mode: 'create', draft });
  }, [profile]);

  const beginEditTour = useCallback((t: Tour) => {
    setTourEditor({ mode: 'edit', draft: { ...t } });
  }, []);

  const saveTour = useCallback(() => {
    if (!tourEditor) return;
    const d = tourEditor.draft;
    if (!d.title.trim() || !d.city.trim() || !d.description.trim() || !d.meetingPoint.trim()) {
      Alert.alert('Missing fields', 'Title, city, description, and meeting point are required.');
      return;
    }
    if (d.availableSlots.length === 0) {
      Alert.alert('Add at least one slot', 'Visitors can only book dates you publish.');
      return;
    }
    if (d.itinerary.length === 0) {
      Alert.alert('Add at least one stop', 'Tell visitors what they\'ll see — at least one stop on the walk.');
      return;
    }
    const isCreate = tourEditor.mode === 'create';
    setMyTours((prev) => {
      if (isCreate) return [d, ...prev];
      return prev.map((t) => (t.id === d.id ? d : t));
    });
    // First-create: simulate two inbound booking requests so the inbox has
    // something to react to.
    if (isCreate) {
      setTimeout(() => {
        setInbox((prev) => [
          ...prev,
          ...generateSimulatedBookings(d, 2),
        ]);
      }, 1400);
    }
    setTourEditor(null);
    tap('success');
  }, [tourEditor, tap]);

  const deleteTour = useCallback((t: Tour) => {
    Alert.alert('Delete this tour?', `"${t.title}" and any pending bookings on it will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setMyTours((prev) => prev.filter((x) => x.id !== t.id));
          setInbox((prev) => prev.filter((b) => b.tourId !== t.id));
          setTourEditor(null);
          tap('warning');
        },
      },
    ]);
  }, [tap]);

  const saveBookingEdit = useCallback(() => {
    if (!editingBooking) return;
    const { booking, date, time, party, note } = editingBooking;
    if (!parseDate(date) || !parseTime(time)) {
      Alert.alert('Invalid date or time');
      return;
    }
    if (party < 1 || party > 20) { Alert.alert('Party size', '1 to 20.'); return; }
    setMyBookings((prev) =>
      prev.map((x) => (x.id === booking.id ? { ...x, date, time, partySize: party, note, status: 'pending' as BookingStatus } : x)),
    );
    // mirror to inbox if it was a self-booking on a user-owned tour
    if (booking.fromUserId === 'me') {
      setInbox((prev) =>
        prev.map((x) => (x.id === booking.id ? { ...x, date, time, partySize: party, note, status: 'pending' as BookingStatus } : x)),
      );
    }
    setEditingBooking(null);
    tap('success');
  }, [editingBooking, tap]);

  const cancelBooking = useCallback((b: Booking) => {
    Alert.alert('Cancel this booking?', `Your request for "${b.tourTitle}" will be removed.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel booking', style: 'destructive', onPress: () => {
          setMyBookings((prev) => prev.filter((x) => x.id !== b.id));
          if (b.fromUserId === 'me') {
            setInbox((prev) => prev.filter((x) => x.id !== b.id));
          }
          setEditingBooking(null);
          tap('warning');
        },
      },
    ]);
  }, [tap]);

  const respondInbox = useCallback((b: Booking, decision: 'confirmed' | 'declined') => {
    setInbox((prev) => prev.map((x) => (x.id === b.id ? { ...x, status: decision } : x)));
    // If this booking originated from the user-as-tourist on their own
    // tour, mirror the decision back into myBookings so both sides agree.
    if (b.fromUserId === 'me') {
      setMyBookings((prev) => prev.map((x) => (x.id === b.id ? { ...x, status: decision } : x)));
    }
    tap(decision === 'confirmed' ? 'success' : 'light');
  }, [tap]);

  // ---------- render ----------

  if (!loaded) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={styles.brand}>Strollmap</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>Stroll<Text style={styles.brandItalic}>map</Text></Text>
          <Text style={styles.brandSub}>
            {mode === 'tourist' ? 'Find a free walking tour' : 'Your guide dashboard'}
          </Text>
        </View>
        <Pressable
          onPress={() => { setMode((m) => (m === 'tourist' ? 'guide' : 'tourist')); tap('medium'); }}
          style={({ pressed }) => [styles.modePill, mode === 'guide' && styles.modePillGuide, pressed && { opacity: 0.85 }]}
          hitSlop={6}
        >
          <Text style={[styles.modePillText, mode === 'guide' && styles.modePillTextGuide]}>
            {mode === 'tourist' ? 'I’m a tourist' : 'I’m a guide'}
          </Text>
        </Pressable>
      </View>

      {/* Body */}
      <View style={{ flex: 1 }}>
        {mode === 'tourist' && touristTab === 'browse' && (
          <BrowseView
            tours={visibleTours}
            cities={cities}
            browseCity={browseCity}
            browseCategory={browseCategory}
            onCity={setBrowseCity}
            onCategory={setBrowseCategory}
            onOpenTour={openTour}
            bookingCountFor={bookingCountFor}
          />
        )}
        {mode === 'tourist' && touristTab === 'bookings' && (
          <MyBookingsView
            upcoming={upcomingBookings}
            past={pastBookings}
            onOpenBooking={(b) => {
              const t = allTours.find((x) => x.id === b.tourId) ?? null;
              setEditingBooking({
                booking: b, tour: t,
                date: b.date, time: b.time, party: b.partySize, note: b.note,
              });
            }}
          />
        )}
        {mode === 'tourist' && touristTab === 'profile' && (
          <ProfileView profile={profile} onChange={setProfile} mode={mode} haptics={haptics} onHaptics={setHaptics} />
        )}

        {mode === 'guide' && guideTab === 'tours' && (
          <MyToursView
            tours={myTours}
            bookingsByTour={inbox}
            onCreate={beginCreateTour}
            onEdit={beginEditTour}
          />
        )}
        {mode === 'guide' && guideTab === 'inbox' && (
          <InboxView pending={pendingInbox} handled={handledInbox} onRespond={respondInbox} />
        )}
        {mode === 'guide' && guideTab === 'profile' && (
          <ProfileView profile={profile} onChange={setProfile} mode={mode} haptics={haptics} onHaptics={setHaptics} />
        )}
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {mode === 'tourist' ? (
          <>
            <TabBtn label="Browse"   active={touristTab === 'browse'}   onPress={() => setTouristTab('browse')} />
            <TabBtn label="Bookings" active={touristTab === 'bookings'} onPress={() => setTouristTab('bookings')} badge={upcomingBookings.length} />
            <TabBtn label="Profile"  active={touristTab === 'profile'}  onPress={() => setTouristTab('profile')} />
          </>
        ) : (
          <>
            <TabBtn label="My tours" active={guideTab === 'tours'}    onPress={() => setGuideTab('tours')} />
            <TabBtn label="Inbox"    active={guideTab === 'inbox'}    onPress={() => setGuideTab('inbox')} badge={pendingInbox.length} />
            <TabBtn label="Profile"  active={guideTab === 'profile'}  onPress={() => setGuideTab('profile')} />
          </>
        )}
      </View>

      {/* Tour detail modal */}
      <Modal visible={!!selectedTour} animationType="slide" onRequestClose={closeTour} presentationStyle="pageSheet">
        {selectedTour && (
          <TourDetailView
            tour={selectedTour}
            bookings={bookingCountFor(selectedTour)}
            onClose={closeTour}
            onBook={() => beginBooking(selectedTour)}
          />
        )}
      </Modal>

      {/* Booking modal */}
      <Modal visible={!!bookingDraft} transparent animationType="fade" onRequestClose={() => setBookingDraft(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setBookingDraft(null)} />
          {bookingDraft && (
            <View style={styles.modalCard}>
              <Text style={styles.modalEyebrow}>BOOK THIS TOUR</Text>
              <Text style={styles.modalTitle}>{bookingDraft.tour.title}</Text>
              <Text style={styles.modalSub}>with {bookingDraft.tour.guideName} · {bookingDraft.tour.city}</Text>

              <Text style={styles.fieldLabel}>Pick a slot</Text>
              {bookingDraft.tour.availableSlots.length === 0 ? (
                <Text style={styles.bodyMuted}>No upcoming slots — message the guide and they can open one.</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {bookingDraft.tour.availableSlots.map((s) => {
                    const active = s.date === bookingDraft.date && s.time === bookingDraft.time;
                    return (
                      <Pressable
                        key={`${s.date}-${s.time}`}
                        onPress={() => setBookingDraft({ ...bookingDraft, date: s.date, time: s.time })}
                        style={[styles.slotChip, active && styles.slotChipActive]}
                      >
                        <Text style={[styles.slotChipDate, active && styles.slotChipTextActive]}>{formatDate(s.date)}</Text>
                        <Text style={[styles.slotChipTime, active && styles.slotChipTextActive]}>{s.time}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}

              <Text style={styles.fieldLabel}>Party size</Text>
              <View style={styles.stepperRow}>
                <Pressable
                  onPress={() => setBookingDraft({ ...bookingDraft, party: Math.max(1, bookingDraft.party - 1) })}
                  style={({ pressed }) => [styles.stepper, pressed && { opacity: 0.7 }]}
                ><Text style={styles.stepperText}>−</Text></Pressable>
                <Text style={styles.stepperVal}>{bookingDraft.party}</Text>
                <Pressable
                  onPress={() => setBookingDraft({ ...bookingDraft, party: Math.min(20, bookingDraft.party + 1) })}
                  style={({ pressed }) => [styles.stepper, pressed && { opacity: 0.7 }]}
                ><Text style={styles.stepperText}>+</Text></Pressable>
                <Text style={styles.stepperLabel}>
                  {bookingDraft.party === 1 ? 'person' : 'people'}
                </Text>
              </View>

              <Text style={styles.fieldLabel}>Note to guide (optional)</Text>
              <TextInput
                value={bookingDraft.note}
                onChangeText={(v) => setBookingDraft({ ...bookingDraft, note: v })}
                placeholder="Allergies, languages, anything they should know"
                placeholderTextColor={COLORS.inkSubtle}
                style={[styles.input, styles.textarea]}
                multiline
              />

              <View style={styles.modalActions}>
                <Pressable onPress={() => setBookingDraft(null)} style={styles.modalBtn}>
                  <Text style={styles.modalBtnText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={confirmBooking} style={[styles.modalBtn, styles.modalBtnPrimary]}>
                  <Text style={[styles.modalBtnText, styles.modalBtnTextPrimary]}>Send request</Text>
                </Pressable>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit existing booking (tourist) */}
      <Modal visible={!!editingBooking} transparent animationType="fade" onRequestClose={() => setEditingBooking(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditingBooking(null)} />
          {editingBooking && (
            <View style={styles.modalCard}>
              <Text style={styles.modalEyebrow}>MODIFY BOOKING</Text>
              <Text style={styles.modalTitle}>{editingBooking.booking.tourTitle}</Text>
              <Text style={styles.modalSub}>with {editingBooking.booking.guideName} · {editingBooking.booking.tourCity}</Text>

              <Text style={styles.fieldLabel}>Pick a different slot</Text>
              {editingBooking.tour && editingBooking.tour.availableSlots.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {editingBooking.tour.availableSlots.map((s) => {
                    const active = s.date === editingBooking.date && s.time === editingBooking.time;
                    return (
                      <Pressable
                        key={`${s.date}-${s.time}`}
                        onPress={() => setEditingBooking({ ...editingBooking, date: s.date, time: s.time })}
                        style={[styles.slotChip, active && styles.slotChipActive]}
                      >
                        <Text style={[styles.slotChipDate, active && styles.slotChipTextActive]}>{formatDate(s.date)}</Text>
                        <Text style={[styles.slotChipTime, active && styles.slotChipTextActive]}>{s.time}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : (
                <Text style={styles.bodyMuted}>The guide has no other slots open right now.</Text>
              )}
              <Text style={styles.bodyMuted}>Currently set for {formatDate(editingBooking.date)} · {editingBooking.time}</Text>

              <Text style={styles.fieldLabel}>Party size</Text>
              <View style={styles.stepperRow}>
                <Pressable
                  onPress={() => setEditingBooking({ ...editingBooking, party: Math.max(1, editingBooking.party - 1) })}
                  style={({ pressed }) => [styles.stepper, pressed && { opacity: 0.7 }]}
                ><Text style={styles.stepperText}>−</Text></Pressable>
                <Text style={styles.stepperVal}>{editingBooking.party}</Text>
                <Pressable
                  onPress={() => setEditingBooking({ ...editingBooking, party: Math.min(20, editingBooking.party + 1) })}
                  style={({ pressed }) => [styles.stepper, pressed && { opacity: 0.7 }]}
                ><Text style={styles.stepperText}>+</Text></Pressable>
                <Text style={styles.stepperLabel}>{editingBooking.party === 1 ? 'person' : 'people'}</Text>
              </View>

              <Text style={styles.fieldLabel}>Note to guide</Text>
              <TextInput
                value={editingBooking.note}
                onChangeText={(v) => setEditingBooking({ ...editingBooking, note: v })}
                placeholder="Anything they should know"
                placeholderTextColor={COLORS.inkSubtle}
                style={[styles.input, styles.textarea]}
                multiline
              />

              <View style={styles.modalActions}>
                <Pressable onPress={() => cancelBooking(editingBooking.booking)} style={[styles.modalBtn, styles.modalBtnDanger]}>
                  <Text style={[styles.modalBtnText, styles.modalBtnTextDanger]}>Cancel booking</Text>
                </Pressable>
                <Pressable onPress={saveBookingEdit} style={[styles.modalBtn, styles.modalBtnPrimary]}>
                  <Text style={[styles.modalBtnText, styles.modalBtnTextPrimary]}>Update</Text>
                </Pressable>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </Modal>

      {/* Tour editor (guide) */}
      <Modal visible={!!tourEditor} animationType="slide" onRequestClose={() => setTourEditor(null)} presentationStyle="pageSheet">
        {tourEditor && (
          <TourEditorView
            mode={tourEditor.mode}
            draft={tourEditor.draft}
            onChange={(d) => setTourEditor({ ...tourEditor, draft: d })}
            onClose={() => setTourEditor(null)}
            onSave={saveTour}
            onDelete={tourEditor.mode === 'edit' ? () => deleteTour(tourEditor.draft) : undefined}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

// ---------- views ----------

function BrowseView({
  tours, cities, browseCity, browseCategory, onCity, onCategory, onOpenTour, bookingCountFor,
}: {
  tours: Tour[];
  cities: string[];
  browseCity: string | null;
  browseCategory: Category | null;
  onCity: (c: string | null) => void;
  onCategory: (c: Category | null) => void;
  onOpenTour: (t: Tour) => void;
  bookingCountFor: (t: Tour) => number;
}) {
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.filterStack}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <FilterChip label="All cities" active={browseCity == null} onPress={() => onCity(null)} />
          {cities.map((c) => (
            <FilterChip key={c} label={c} active={browseCity === c} onPress={() => onCity(c === browseCity ? null : c)} />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <FilterChip label="All themes" active={browseCategory == null} onPress={() => onCategory(null)} />
          {CATEGORIES.map((c) => (
            <FilterChip
              key={c.id}
              label={`${c.emoji} ${c.label}`}
              active={browseCategory === c.id}
              onPress={() => onCategory(c.id === browseCategory ? null : c.id)}
            />
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={tours}
        keyExtractor={(t) => t.id}
        contentContainerStyle={tours.length === 0 ? styles.emptyWrap : styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No tours match those filters</Text>
            <Text style={styles.emptyBody}>Clear a chip above to see everything.</Text>
          </View>
        }
        renderItem={({ item }) => <TourCard tour={item} bookings={bookingCountFor(item)} onPress={() => onOpenTour(item)} />}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />
    </View>
  );
}

function TourCard({ tour, bookings, onPress }: { tour: Tour; bookings: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}>
      <View style={[styles.cardCover, { backgroundColor: tour.coverColor }]}>
        <Text style={styles.cardCoverEmoji}>{tour.cover}</Text>
        <View style={styles.cardCityBadge}>
          <Text style={styles.cardCityText}>{tour.city}</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>{tour.title}</Text>
        <View style={styles.cardMetaRow}>
          <Text style={styles.cardGuide}>{tour.guideAvatar}  {tour.guideName}</Text>
          {tour.guideReviewCount > 0 ? (
            <Text style={styles.cardRating}>★ {tour.guideRating.toFixed(1)} <Text style={styles.cardReviews}>({tour.guideReviewCount})</Text></Text>
          ) : (
            <Text style={styles.cardReviews}>No reviews yet</Text>
          )}
        </View>
        <View style={styles.cardMetaRow}>
          <Text style={styles.cardMeta}>{tour.durationMin} min · {tour.languages.join(', ')}</Text>
          <Text style={styles.cardPrice}>Free · tip-based</Text>
        </View>
        <View style={styles.cardMetaRow}>
          <Text style={styles.cardMeta}>{bookings} {bookings === 1 ? 'booking' : 'bookings'} so far</Text>
        </View>
      </View>
    </Pressable>
  );
}

function TourDetailView({ tour, bookings, onClose, onBook }: { tour: Tour; bookings: number; onClose: () => void; onBook: () => void }) {
  return (
    <SafeAreaView style={styles.root}>
      <ScrollView>
        <View style={[styles.detailCover, { backgroundColor: tour.coverColor }]}>
          <Pressable onPress={onClose} style={styles.detailClose} hitSlop={10}>
            <Text style={styles.detailCloseText}>Close</Text>
          </Pressable>
          <Text style={styles.detailCoverEmoji}>{tour.cover}</Text>
        </View>
        <View style={styles.detailBody}>
          <Text style={styles.detailEyebrow}>{tour.city.toUpperCase()} · {tour.country}</Text>
          <Text style={styles.detailTitle}>{tour.title}</Text>

          <View style={styles.detailGuideRow}>
            <Text style={styles.detailGuideAvatar}>{tour.guideAvatar}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.detailGuideName}>{tour.guideName}</Text>
              <Text style={styles.detailGuideRating}>
                {tour.guideReviewCount > 0
                  ? `★ ${tour.guideRating.toFixed(2)} · ${tour.guideReviewCount} reviews`
                  : 'New guide · no reviews yet'}
              </Text>
            </View>
          </View>

          <View style={styles.detailMetaGrid}>
            <DetailMeta label="DURATION"  value={`${tour.durationMin} min`} />
            <DetailMeta label="THEME"     value={CATEGORIES.find((c) => c.id === tour.category)?.label ?? tour.category} />
            <DetailMeta label="LANGUAGES" value={tour.languages.join(', ')} />
            <DetailMeta label="BOOKINGS"  value={`${bookings} so far`} />
          </View>

          <Text style={styles.detailSectionLabel}>About this walk</Text>
          <Text style={styles.detailBodyText}>{tour.description}</Text>

          {tour.itinerary.length > 0 && (
            <>
              <Text style={styles.detailSectionLabel}>Itinerary</Text>
              <View>
                {tour.itinerary.map((s, i) => (
                  <View key={i} style={styles.detailItinRow}>
                    <Text style={styles.detailItinNum}>{String(i + 1).padStart(2, '0')}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.detailItinTitle}>{s.title}</Text>
                      {s.note ? <Text style={styles.detailItinNote}>{s.note}</Text> : null}
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}

          <Text style={styles.detailSectionLabel}>Meeting point</Text>
          <Text style={styles.detailBodyText}>{tour.meetingPoint}</Text>

          <Text style={styles.detailSectionLabel}>Typical schedule</Text>
          <View style={styles.detailChipRow}>
            {tour.schedule.length === 0
              ? <Text style={styles.detailBodyText}>By request — send a date that works for you.</Text>
              : tour.schedule.map((s) => (
                  <View key={s} style={styles.detailScheduleChip}>
                    <Text style={styles.detailScheduleText}>{s}</Text>
                  </View>
                ))}
          </View>
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>
      <View style={styles.detailCta}>
        <Pressable onPress={onBook} style={({ pressed }) => [styles.bigCtaBtn, pressed && { opacity: 0.88 }]}>
          <Text style={styles.bigCtaText}>Request this tour</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function DetailMeta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailMetaCell}>
      <Text style={styles.detailMetaLabel}>{label}</Text>
      <Text style={styles.detailMetaValue}>{value}</Text>
    </View>
  );
}

function MyBookingsView({
  upcoming, past, onOpenBooking,
}: { upcoming: Booking[]; past: Booking[]; onOpenBooking: (b: Booking) => void }) {
  const sections: { title: string; data: Booking[] }[] = [
    { title: 'Upcoming', data: upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)) },
    { title: 'Past',     data: past.sort((a, b) => b.bookedAt - a.bookedAt) },
  ];
  const empty = upcoming.length === 0 && past.length === 0;
  return (
    <ScrollView contentContainerStyle={empty ? styles.emptyWrap : styles.listContent}>
      {empty && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No bookings yet</Text>
          <Text style={styles.emptyBody}>Tap a tour on Browse and request a date. Your bookings will appear here.</Text>
        </View>
      )}
      {sections.map((s) => s.data.length > 0 && (
        <View key={s.title} style={{ marginBottom: 18 }}>
          <Text style={styles.sectionHeader}>{s.title.toUpperCase()}</Text>
          {s.data.map((b) => (
            <Pressable
              key={b.id}
              onPress={() => onOpenBooking(b)}
              style={({ pressed }) => [styles.bookingRow, pressed && { opacity: 0.92 }]}
            >
              <View style={[styles.bookingCover, { backgroundColor: b.tourCoverColor }]}>
                <Text style={styles.bookingCoverEmoji}>{b.tourCover}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bookingTitle} numberOfLines={1}>{b.tourTitle}</Text>
                <Text style={styles.bookingMeta}>{b.tourCity} · {b.guideName}</Text>
                <Text style={styles.bookingMeta}>{formatDate(b.date)} · {b.time} · {b.partySize} {b.partySize === 1 ? 'person' : 'people'}</Text>
              </View>
              <View style={[styles.statusBadge, statusStyles[b.status]]}>
                <Text style={[styles.statusText, statusTextStyles[b.status]]}>{b.status}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function MyToursView({
  tours, bookingsByTour, onCreate, onEdit,
}: {
  tours: Tour[];
  bookingsByTour: Booking[];
  onCreate: () => void;
  onEdit: (t: Tour) => void;
}) {
  const countFor = (id: string) => bookingsByTour.filter((b) => b.tourId === id).length;
  return (
    <View style={{ flex: 1 }}>
      <Pressable onPress={onCreate} style={({ pressed }) => [styles.createBar, pressed && { opacity: 0.9 }]}>
        <Text style={styles.createBarText}>+ Create a new tour</Text>
      </Pressable>
      <ScrollView contentContainerStyle={tours.length === 0 ? styles.emptyWrap : styles.listContent}>
        {tours.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>You haven't published a tour yet</Text>
            <Text style={styles.emptyBody}>Tap + Create above to write your first listing. Tourists in your city will see it on Browse.</Text>
          </View>
        )}
        {tours.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => onEdit(t)}
            style={({ pressed }) => [styles.tourEditCard, pressed && { opacity: 0.92 }]}
          >
            <View style={[styles.cardCover, styles.cardCoverSmall, { backgroundColor: t.coverColor }]}>
              <Text style={styles.cardCoverEmoji}>{t.cover}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.cardTitle} numberOfLines={2}>{t.title}</Text>
              <Text style={styles.cardMeta}>{t.city} · {t.durationMin} min</Text>
              <Text style={styles.tourEditCount}>{countFor(t.id)} {countFor(t.id) === 1 ? 'request' : 'requests'} in inbox</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function InboxView({
  pending, handled, onRespond,
}: {
  pending: Booking[];
  handled: Booking[];
  onRespond: (b: Booking, decision: 'confirmed' | 'declined') => void;
}) {
  const empty = pending.length === 0 && handled.length === 0;
  return (
    <ScrollView contentContainerStyle={empty ? styles.emptyWrap : styles.listContent}>
      {empty && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Inbox is empty</Text>
          <Text style={styles.emptyBody}>Create a tour on My tours to start receiving (simulated) bookings here.</Text>
        </View>
      )}
      {pending.length > 0 && (
        <View style={{ marginBottom: 18 }}>
          <Text style={styles.sectionHeader}>PENDING — {pending.length}</Text>
          {pending.map((b) => (
            <View key={b.id} style={styles.inboxCard}>
              <View style={styles.inboxTopRow}>
                <Text style={styles.inboxAvatar}>{b.fromAvatar}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inboxName}>{b.fromName}</Text>
                  <Text style={styles.inboxMeta}>{b.partySize} {b.partySize === 1 ? 'person' : 'people'} · {formatDate(b.date)} · {b.time}</Text>
                </View>
              </View>
              <Text style={styles.inboxTourTitle} numberOfLines={1}>{b.tourTitle}</Text>
              {b.note ? <Text style={styles.inboxNote}>"{b.note}"</Text> : null}
              <View style={styles.inboxActions}>
                <Pressable onPress={() => onRespond(b, 'declined')} style={({ pressed }) => [styles.inboxBtn, pressed && { opacity: 0.85 }]}>
                  <Text style={styles.inboxBtnText}>Decline</Text>
                </Pressable>
                <Pressable onPress={() => onRespond(b, 'confirmed')} style={({ pressed }) => [styles.inboxBtn, styles.inboxBtnPrimary, pressed && { opacity: 0.85 }]}>
                  <Text style={[styles.inboxBtnText, styles.inboxBtnTextPrimary]}>Confirm</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
      {handled.length > 0 && (
        <View>
          <Text style={styles.sectionHeader}>HANDLED</Text>
          {handled.map((b) => (
            <View key={b.id} style={styles.inboxCardSmall}>
              <Text style={styles.inboxAvatarSmall}>{b.fromAvatar}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.inboxNameSmall}>{b.fromName} · {b.partySize}p</Text>
                <Text style={styles.inboxMetaSmall} numberOfLines={1}>{b.tourTitle}</Text>
              </View>
              <View style={[styles.statusBadge, statusStyles[b.status]]}>
                <Text style={[styles.statusText, statusTextStyles[b.status]]}>{b.status}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function ProfileView({
  profile, onChange, mode, haptics, onHaptics,
}: {
  profile: Profile;
  onChange: (p: Profile) => void;
  mode: Mode;
  haptics: boolean;
  onHaptics: (v: boolean) => void;
}) {
  const [draft, setDraft] = useState(profile);
  useEffect(() => { setDraft(profile); }, [profile]);

  const saveDraft = useCallback(() => {
    onChange(draft);
    Alert.alert('Saved', 'Your profile has been updated.');
  }, [draft, onChange]);

  const toggleLang = (lang: string) => {
    setDraft((p) => {
      const has = p.languages.includes(lang);
      return { ...p, languages: has ? p.languages.filter((l) => l !== lang) : [...p.languages, lang] };
    });
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 60 }}>
      <Text style={styles.sectionHeader}>PROFILE</Text>
      <View style={styles.profileTopRow}>
        <View style={styles.profileAvatarWrap}>
          <Text style={styles.profileAvatar}>{draft.avatar}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <TextInput
            value={draft.name}
            onChangeText={(v) => setDraft({ ...draft, name: v })}
            placeholder="Your name"
            placeholderTextColor={COLORS.inkSubtle}
            style={[styles.input, { marginBottom: 8 }]}
          />
          <TextInput
            value={draft.city}
            onChangeText={(v) => setDraft({ ...draft, city: v })}
            placeholder="City"
            placeholderTextColor={COLORS.inkSubtle}
            style={styles.input}
          />
        </View>
      </View>

      <Text style={styles.fieldLabel}>Pick an emoji avatar</Text>
      <View style={styles.emojiRow}>
        {['🙂', '😎', '🧑🏻', '🧑🏽', '🧑🏿', '👩🏼', '👩🏽‍🦱', '👨🏻‍🦰', '🦊', '🦉'].map((e) => (
          <Pressable
            key={e}
            onPress={() => setDraft({ ...draft, avatar: e })}
            style={[styles.emojiCell, draft.avatar === e && styles.emojiCellActive]}
          >
            <Text style={styles.emojiText}>{e}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Bio</Text>
      <TextInput
        value={draft.bio}
        onChangeText={(v) => setDraft({ ...draft, bio: v })}
        placeholder={mode === 'guide' ? 'Tell visitors what makes your tours yours' : 'A line about yourself (optional)'}
        placeholderTextColor={COLORS.inkSubtle}
        style={[styles.input, styles.textarea]}
        multiline
      />

      <Text style={styles.fieldLabel}>Languages</Text>
      <View style={styles.chipRow}>
        {LANGUAGES_OPTIONS.map((l) => {
          const active = draft.languages.includes(l);
          return (
            <Pressable
              key={l}
              onPress={() => toggleLang(l)}
              style={[styles.langChip, active && styles.langChipActive]}
            >
              <Text style={[styles.langChipText, active && styles.langChipTextActive]}>{l}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable onPress={saveDraft} style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }]}>
        <Text style={styles.saveBtnText}>Save profile</Text>
      </Pressable>

      <Text style={[styles.sectionHeader, { marginTop: 26 }]}>SETTINGS</Text>
      <Pressable
        onPress={() => onHaptics(!haptics)}
        style={styles.settingRow}
        hitSlop={6}
      >
        <Text style={styles.settingLabel}>Haptics</Text>
        <Text style={styles.settingValue}>{haptics ? '◉ On' : '◯ Off'}</Text>
      </Pressable>

      <View style={styles.demoFootnote}>
        <Text style={styles.demoFootnoteHead}>About this demo</Text>
        <Text style={styles.demoFootnoteBody}>
          Strollmap stores everything on this device only. There's no server, so tours and bookings don't sync to other phones. To respond to your tour as a "guide", flip the toggle at the top right — simulated requests will appear in the Inbox after you create a tour.
        </Text>
      </View>
    </ScrollView>
  );
}

function TourEditorView({
  mode, draft, onChange, onClose, onSave, onDelete,
}: {
  mode: 'create' | 'edit';
  draft: Tour;
  onChange: (d: Tour) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const toggleLang = (lang: string) => {
    const has = draft.languages.includes(lang);
    onChange({ ...draft, languages: has ? draft.languages.filter((l) => l !== lang) : [...draft.languages, lang] });
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.editorHeader}>
        <Pressable onPress={onClose} hitSlop={8}><Text style={styles.editorClose}>Cancel</Text></Pressable>
        <Text style={styles.editorTitle}>{mode === 'create' ? 'New tour' : 'Edit tour'}</Text>
        <Pressable onPress={onSave} hitSlop={8}><Text style={[styles.editorClose, { color: COLORS.accent }]}>Save</Text></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 60 }}>
        <View style={[styles.editorCover, { backgroundColor: draft.coverColor }]}>
          <Text style={styles.editorCoverEmoji}>{draft.cover}</Text>
        </View>

        <Text style={styles.fieldLabel}>Cover emoji</Text>
        <View style={styles.emojiRow}>
          {COVER_EMOJI.map((e) => (
            <Pressable
              key={e}
              onPress={() => onChange({ ...draft, cover: e })}
              style={[styles.emojiCell, draft.cover === e && styles.emojiCellActive]}
            ><Text style={styles.emojiText}>{e}</Text></Pressable>
          ))}
        </View>

        <Text style={styles.fieldLabel}>Cover color</Text>
        <View style={styles.colorRow}>
          {COVER_PALETTE.map((c) => (
            <Pressable
              key={c}
              onPress={() => onChange({ ...draft, coverColor: c })}
              style={[styles.colorSwatch, { backgroundColor: c }, draft.coverColor === c && styles.colorSwatchActive]}
            />
          ))}
        </View>

        <Text style={styles.fieldLabel}>Title</Text>
        <TextInput
          value={draft.title} onChangeText={(v) => onChange({ ...draft, title: v })}
          placeholder="What's the walk called?"
          placeholderTextColor={COLORS.inkSubtle}
          style={styles.input} maxLength={80}
        />

        <Text style={styles.fieldLabel}>City</Text>
        <TextInput
          value={draft.city} onChangeText={(v) => onChange({ ...draft, city: v })}
          placeholder="Where does it start?"
          placeholderTextColor={COLORS.inkSubtle}
          style={styles.input}
        />

        <Text style={styles.fieldLabel}>Description</Text>
        <TextInput
          value={draft.description} onChangeText={(v) => onChange({ ...draft, description: v })}
          placeholder="What will visitors see, hear, taste? Where do they end up?"
          placeholderTextColor={COLORS.inkSubtle}
          style={[styles.input, styles.textarea]} multiline
        />

        <Text style={styles.fieldLabel}>Meeting point</Text>
        <TextInput
          value={draft.meetingPoint} onChangeText={(v) => onChange({ ...draft, meetingPoint: v })}
          placeholder="Be specific — a metro exit, a statue, a landmark"
          placeholderTextColor={COLORS.inkSubtle}
          style={styles.input}
        />

        <Text style={styles.fieldLabel}>Duration (minutes)</Text>
        <View style={styles.stepperRow}>
          <Pressable
            onPress={() => onChange({ ...draft, durationMin: Math.max(30, draft.durationMin - 15) })}
            style={({ pressed }) => [styles.stepper, pressed && { opacity: 0.7 }]}
          ><Text style={styles.stepperText}>−</Text></Pressable>
          <Text style={styles.stepperVal}>{draft.durationMin}</Text>
          <Pressable
            onPress={() => onChange({ ...draft, durationMin: Math.min(300, draft.durationMin + 15) })}
            style={({ pressed }) => [styles.stepper, pressed && { opacity: 0.7 }]}
          ><Text style={styles.stepperText}>+</Text></Pressable>
          <Text style={styles.stepperLabel}>min</Text>
        </View>

        <Text style={styles.fieldLabel}>Available slots</Text>
        <Text style={styles.bodyMuted}>Add specific dates + times visitors can book. They can only pick from this list.</Text>
        <SlotEditor
          slots={draft.availableSlots}
          onChange={(slots) => onChange({ ...draft, availableSlots: slots })}
        />

        <Text style={styles.fieldLabel}>Itinerary (at least one stop)</Text>
        <Text style={styles.bodyMuted}>Where do you take people? Number, name, and (optionally) a one-line note for each stop.</Text>
        <ItineraryEditor
          stops={draft.itinerary}
          onChange={(it) => onChange({ ...draft, itinerary: it })}
        />

        <Text style={styles.fieldLabel}>Theme</Text>
        <View style={styles.chipRow}>
          {CATEGORIES.map((c) => {
            const active = draft.category === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => onChange({ ...draft, category: c.id })}
                style={[styles.langChip, active && styles.langChipActive]}
              >
                <Text style={[styles.langChipText, active && styles.langChipTextActive]}>{c.emoji} {c.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.fieldLabel}>Languages spoken</Text>
        <View style={styles.chipRow}>
          {LANGUAGES_OPTIONS.map((l) => {
            const active = draft.languages.includes(l);
            return (
              <Pressable
                key={l}
                onPress={() => toggleLang(l)}
                style={[styles.langChip, active && styles.langChipActive]}
              >
                <Text style={[styles.langChipText, active && styles.langChipTextActive]}>{l}</Text>
              </Pressable>
            );
          })}
        </View>

        {onDelete && (
          <Pressable onPress={onDelete} style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.8 }]}>
            <Text style={styles.deleteBtnText}>Delete this tour</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------- bits ----------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function SlotEditor({
  slots, onChange,
}: { slots: { date: string; time: string }[]; onChange: (s: { date: string; time: string }[]) => void }) {
  const [date, setDate] = useState(todayPlus(7));
  const [time, setTime] = useState('10:00');
  const [weekly, setWeekly] = useState({ weekday: new Date().getDay(), time: '10:00', repeats: 8 });

  const mergeSlots = (extra: { date: string; time: string }[]) => {
    const map = new Map<string, { date: string; time: string }>();
    for (const s of [...slots, ...extra]) map.set(`${s.date}|${s.time}`, s);
    const next = Array.from(map.values()).sort(
      (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time),
    );
    onChange(next);
  };

  const add = () => {
    if (!parseDate(date)) { Alert.alert('Date format', 'YYYY-MM-DD, e.g. ' + todayPlus(7)); return; }
    if (!parseTime(time)) { Alert.alert('Time format', '24-hour HH:MM, e.g. 10:30'); return; }
    if (slots.some((s) => s.date === date && s.time === time)) {
      Alert.alert('Already added', 'That date and time is already in your list.');
      return;
    }
    mergeSlots([{ date, time }]);
  };

  const addWeekly = () => {
    if (!parseTime(weekly.time)) { Alert.alert('Time format', '24-hour HH:MM'); return; }
    if (weekly.repeats < 1 || weekly.repeats > 26) { Alert.alert('Repeats', 'Between 1 and 26.'); return; }
    // Find next occurrence of the chosen weekday (>= today).
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let delta = (weekly.weekday - today.getDay() + 7) % 7;
    if (delta === 0) delta = 7; // start next week to keep the chip in the future
    const generated: { date: string; time: string }[] = [];
    for (let i = 0; i < weekly.repeats; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + delta + i * 7);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      generated.push({ date: `${y}-${m}-${day}`, time: weekly.time });
    }
    mergeSlots(generated);
  };

  const remove = (idx: number) => {
    const next = slots.slice();
    next.splice(idx, 1);
    onChange(next);
  };

  const clearAll = () => {
    if (slots.length === 0) return;
    Alert.alert('Clear all slots?', 'Visitors won\'t be able to book until you add new ones.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear all', style: 'destructive', onPress: () => onChange([]) },
    ]);
  };

  return (
    <View>
      <View style={styles.slotList}>
        {slots.length === 0
          ? <Text style={styles.bodyMuted}>No slots yet — add one below or use Repeat weekly.</Text>
          : slots.map((s, i) => (
              <View key={`${s.date}-${s.time}-${i}`} style={styles.slotPill}>
                <Text style={styles.slotPillDate}>{formatDate(s.date)}</Text>
                <Text style={styles.slotPillTime}>{s.time}</Text>
                <Pressable onPress={() => remove(i)} hitSlop={8}>
                  <Text style={styles.slotPillX}>×</Text>
                </Pressable>
              </View>
            ))}
      </View>

      {slots.length > 0 && (
        <Pressable onPress={clearAll} hitSlop={6} style={{ alignSelf: 'flex-start', marginBottom: 8 }}>
          <Text style={styles.slotClearLink}>Clear all slots</Text>
        </Pressable>
      )}

      <Text style={styles.subFieldLabel}>Add a single date</Text>
      <View style={styles.slotAddRow}>
        <TextInput
          value={date} onChangeText={setDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={COLORS.inkSubtle}
          style={[styles.input, { flex: 2 }]}
          autoCapitalize="none"
        />
        <TextInput
          value={time} onChangeText={setTime}
          placeholder="HH:MM"
          placeholderTextColor={COLORS.inkSubtle}
          style={[styles.input, { flex: 1 }]}
          autoCapitalize="none"
        />
        <Pressable onPress={add} style={({ pressed }) => [styles.slotAddBtn, pressed && { opacity: 0.85 }]}>
          <Text style={styles.slotAddBtnText}>Add</Text>
        </Pressable>
      </View>

      <Text style={styles.subFieldLabel}>Repeat weekly</Text>
      <View style={styles.weekdayRow}>
        {WEEKDAYS.map((w, i) => {
          const active = weekly.weekday === i;
          return (
            <Pressable
              key={w}
              onPress={() => setWeekly({ ...weekly, weekday: i })}
              style={[styles.weekdayChip, active && styles.weekdayChipActive]}
            >
              <Text style={[styles.weekdayChipText, active && styles.weekdayChipTextActive]}>{w}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.slotAddRow}>
        <TextInput
          value={weekly.time} onChangeText={(v) => setWeekly({ ...weekly, time: v })}
          placeholder="HH:MM"
          placeholderTextColor={COLORS.inkSubtle}
          style={[styles.input, { flex: 1 }]}
          autoCapitalize="none"
        />
        <View style={[styles.stepperRow, { flex: 1.4, justifyContent: 'center' }]}>
          <Pressable
            onPress={() => setWeekly({ ...weekly, repeats: Math.max(1, weekly.repeats - 1) })}
            style={({ pressed }) => [styles.stepper, pressed && { opacity: 0.7 }]}
          ><Text style={styles.stepperText}>−</Text></Pressable>
          <Text style={styles.stepperVal}>{weekly.repeats}</Text>
          <Pressable
            onPress={() => setWeekly({ ...weekly, repeats: Math.min(26, weekly.repeats + 1) })}
            style={({ pressed }) => [styles.stepper, pressed && { opacity: 0.7 }]}
          ><Text style={styles.stepperText}>+</Text></Pressable>
        </View>
        <Pressable onPress={addWeekly} style={({ pressed }) => [styles.slotAddBtn, pressed && { opacity: 0.85 }]}>
          <Text style={styles.slotAddBtnText}>Generate</Text>
        </Pressable>
      </View>
      <Text style={styles.bodyMuted}>
        Generates {weekly.repeats} {weekly.repeats === 1 ? 'slot' : 'slots'}, one per week starting next {WEEKDAYS[weekly.weekday]} at {weekly.time}.
      </Text>
    </View>
  );
}

function ItineraryEditor({
  stops, onChange,
}: { stops: { title: string; note?: string }[]; onChange: (s: { title: string; note?: string }[]) => void }) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');

  const add = () => {
    if (!title.trim()) { Alert.alert('Stop name', 'Give the stop a short name.'); return; }
    onChange([...stops, { title: title.trim(), note: note.trim() || undefined }]);
    setTitle('');
    setNote('');
  };
  const remove = (i: number) => {
    const next = stops.slice();
    next.splice(i, 1);
    onChange(next);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    const next = stops.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <View>
      {stops.length === 0
        ? <Text style={styles.bodyMuted}>No stops yet — add at least one (required).</Text>
        : stops.map((s, i) => (
            <View key={i} style={styles.stopRow}>
              <Text style={styles.stopIndex}>{String(i + 1).padStart(2, '0')}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.stopTitle}>{s.title}</Text>
                {s.note ? <Text style={styles.stopNote}>{s.note}</Text> : null}
              </View>
              <View style={styles.stopActions}>
                <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6} style={i === 0 && { opacity: 0.3 }}>
                  <Text style={styles.stopArrow}>↑</Text>
                </Pressable>
                <Pressable onPress={() => move(i, 1)} disabled={i === stops.length - 1} hitSlop={6} style={i === stops.length - 1 && { opacity: 0.3 }}>
                  <Text style={styles.stopArrow}>↓</Text>
                </Pressable>
                <Pressable onPress={() => remove(i)} hitSlop={6}>
                  <Text style={styles.stopX}>×</Text>
                </Pressable>
              </View>
            </View>
          ))}
      <Text style={styles.subFieldLabel}>Add a stop</Text>
      <TextInput
        value={title} onChangeText={setTitle}
        placeholder="e.g. The pasta-rolling demo at Nonna's"
        placeholderTextColor={COLORS.inkSubtle}
        style={styles.input} maxLength={80}
      />
      <TextInput
        value={note} onChangeText={setNote}
        placeholder="Optional note: what happens here"
        placeholderTextColor={COLORS.inkSubtle}
        style={[styles.input, { marginTop: 6 }]}
        maxLength={140}
      />
      <Pressable onPress={add} style={({ pressed }) => [styles.slotAddBtn, { marginTop: 6, alignSelf: 'flex-start' }, pressed && { opacity: 0.85 }]}>
        <Text style={styles.slotAddBtnText}>+ Add stop</Text>
      </Pressable>
    </View>
  );
}

function TabBtn({ label, active, onPress, badge }: { label: string; active: boolean; onPress: () => void; badge?: number }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tabBtn, pressed && { opacity: 0.7 }]}>
      <View style={styles.tabInner}>
        <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
        {badge != null && badge > 0 && (
          <View style={styles.tabBadge}>
            <Text style={styles.tabBadgeText}>{badge}</Text>
          </View>
        )}
      </View>
      {active && <View style={styles.tabUnderline} />}
    </Pressable>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.filterChip, active && styles.filterChipActive, pressed && { opacity: 0.85 }]}
    >
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function generateSimulatedBookings(tour: Tour, count: number): Booking[] {
  const out: Booking[] = [];
  for (let i = 0; i < count; i++) {
    const sim = SIM_TOURIST_NAMES[Math.floor(Math.random() * SIM_TOURIST_NAMES.length)];
    const partySize = 1 + Math.floor(Math.random() * 4);
    const offset = 2 + Math.floor(Math.random() * 10);
    const time = ['09:30', '10:00', '11:00', '14:00', '17:30', '19:00'][Math.floor(Math.random() * 6)];
    const notes = [
      'Three of us, two beginners in this neighborhood. Looking forward to it!',
      'Coming for an afternoon between meetings — happy to keep it brisk.',
      'My partner has a dairy allergy, hope that\'s ok on the food stops.',
      '',
      'First time in the city, will follow your lead!',
    ];
    out.push({
      id: rid(),
      tourId: tour.id,
      tourTitle: tour.title,
      tourCity: tour.city,
      tourCover: tour.cover,
      tourCoverColor: tour.coverColor,
      guideName: tour.guideName,
      partySize,
      date: todayPlus(offset),
      time,
      note: notes[Math.floor(Math.random() * notes.length)],
      status: 'pending',
      bookedAt: Date.now() - i * 60_000,
      fromUserId: `sim-${i}`,
      fromName: sim.name,
      fromAvatar: sim.avatar,
    });
  }
  return out;
}

// ---------- styles ----------

const COLORS = {
  bg:         '#faf5ed',
  surface:    '#ffffff',
  ink:        '#241712',
  inkMuted:   '#6e564a',
  inkSubtle:  '#a8907f',
  rule:       '#e8dcc8',
  ruleSoft:   '#f0e6d5',
  accent:     '#d65a31',
  accentDeep: '#a13a16',
  accentSoft: '#fadcce',
  guide:      '#5a8a6a', // guide-mode accent variant
  warn:       '#a74220',
  ok:         '#5a8a6a',
};

const statusStyles: Record<BookingStatus, { backgroundColor: string }> = {
  pending:   { backgroundColor: '#f5e7d2' },
  confirmed: { backgroundColor: '#dceddf' },
  declined:  { backgroundColor: '#f3dcd2' },
  completed: { backgroundColor: '#e6e6e6' },
};
const statusTextStyles: Record<BookingStatus, { color: string }> = {
  pending:   { color: '#8a6328' },
  confirmed: { color: '#3a6a4a' },
  declined:  { color: '#8a3a2a' },
  completed: { color: '#5a5a5a' },
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule,
  },
  brand: { fontSize: 26, fontWeight: '700', color: COLORS.ink, letterSpacing: -0.3 },
  brandItalic: { fontStyle: 'italic', color: COLORS.accent, fontWeight: '600' },
  brandSub: { fontSize: 12, color: COLORS.inkSubtle, marginTop: 2 },
  modePill: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: COLORS.accentSoft, borderWidth: 1, borderColor: COLORS.accent,
  },
  modePillGuide: { backgroundColor: '#e3f0e6', borderColor: COLORS.guide },
  modePillText: { color: COLORS.accentDeep, fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  modePillTextGuide: { color: '#2c5a3a' },

  tabBar: {
    flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.rule,
    backgroundColor: COLORS.surface,
  },
  tabBtn: { flex: 1, paddingVertical: 14, alignItems: 'center', position: 'relative' },
  tabInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabLabel: { fontSize: 13, color: COLORS.inkMuted, fontWeight: '500' },
  tabLabelActive: { color: COLORS.accent, fontWeight: '700' },
  tabUnderline: {
    position: 'absolute', bottom: 0, left: '25%', right: '25%', height: 2,
    backgroundColor: COLORS.accent, borderRadius: 1,
  },
  tabBadge: {
    minWidth: 18, paddingHorizontal: 5, height: 18, borderRadius: 9,
    backgroundColor: COLORS.accent, alignItems: 'center', justifyContent: 'center',
  },
  tabBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },

  filterStack: {
    paddingTop: 8, paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.ruleSoft,
    backgroundColor: COLORS.surface,
  },
  filterRow: { paddingHorizontal: 14, gap: 6, paddingBottom: 6 },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
    backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.rule,
  },
  filterChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  filterChipText: { color: COLORS.inkMuted, fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#fff' },

  listContent: { padding: 14, paddingBottom: 30 },
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  empty: { alignItems: 'center', maxWidth: 320 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.ink, marginBottom: 6, textAlign: 'center' },
  emptyBody: { fontSize: 13, color: COLORS.inkMuted, textAlign: 'center', lineHeight: 19 },

  sectionHeader: { fontSize: 11, color: COLORS.inkSubtle, letterSpacing: 1.5, fontWeight: '700', marginBottom: 10, marginTop: 4 },

  card: {
    backgroundColor: COLORS.surface, borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: COLORS.rule,
  },
  cardCover: {
    height: 130, alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  cardCoverSmall: { width: 80, height: 80, borderRadius: 12 },
  cardCoverEmoji: { fontSize: 56 },
  cardCityBadge: {
    position: 'absolute', bottom: 10, left: 10,
    backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  cardCityText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  cardBody: { padding: 14 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: COLORS.ink, marginBottom: 6, lineHeight: 19 },
  cardMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  cardGuide: { fontSize: 12, color: COLORS.inkMuted, flexShrink: 1 },
  cardRating: { fontSize: 12, color: COLORS.ink, fontWeight: '600' },
  cardReviews: { color: COLORS.inkSubtle, fontWeight: '400' },
  cardMeta: { fontSize: 11, color: COLORS.inkSubtle, flexShrink: 1 },
  cardPrice: { fontSize: 11, color: COLORS.ok, fontWeight: '700' },

  detailCover: { height: 220, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  detailCoverEmoji: { fontSize: 96 },
  detailClose: {
    position: 'absolute', top: 14, left: 14,
    backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
  },
  detailCloseText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  detailBody: { padding: 20 },
  detailEyebrow: { fontSize: 11, color: COLORS.accent, letterSpacing: 1.5, fontWeight: '700' },
  detailTitle: { fontSize: 24, fontWeight: '700', color: COLORS.ink, marginTop: 6, marginBottom: 16, letterSpacing: -0.3 },
  detailGuideRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  detailGuideAvatar: { fontSize: 38 },
  detailGuideName: { fontSize: 15, fontWeight: '700', color: COLORS.ink },
  detailGuideRating: { fontSize: 12, color: COLORS.inkMuted, marginTop: 2 },
  detailMetaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  detailMetaCell: { flex: 1, minWidth: 130, backgroundColor: COLORS.surface, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: COLORS.rule },
  detailMetaLabel: { fontSize: 9, color: COLORS.inkSubtle, letterSpacing: 1.5, fontWeight: '700' },
  detailMetaValue: { fontSize: 13, color: COLORS.ink, fontWeight: '600', marginTop: 3 },
  detailSectionLabel: { fontSize: 11, color: COLORS.inkSubtle, letterSpacing: 1.5, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  detailBodyText: { fontSize: 14, color: COLORS.inkMuted, lineHeight: 21 },
  detailChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  detailScheduleChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.rule,
  },
  detailScheduleText: { fontSize: 12, color: COLORS.ink, fontWeight: '600' },
  detailCta: {
    padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.rule,
    backgroundColor: COLORS.surface,
  },
  bigCtaBtn: { backgroundColor: COLORS.accent, paddingVertical: 14, borderRadius: 999, alignItems: 'center' },
  bigCtaText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },

  bookingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.surface, padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.rule, marginBottom: 8,
  },
  bookingCover: { width: 56, height: 56, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bookingCoverEmoji: { fontSize: 28 },
  bookingTitle: { fontSize: 14, fontWeight: '700', color: COLORS.ink },
  bookingMeta: { fontSize: 11, color: COLORS.inkMuted, marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'capitalize' },

  createBar: {
    backgroundColor: COLORS.guide, marginHorizontal: 14, marginTop: 14,
    paddingVertical: 14, borderRadius: 12, alignItems: 'center',
  },
  createBarText: { color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 0.3 },
  tourEditCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
    borderRadius: 14, padding: 12, borderWidth: 1, borderColor: COLORS.rule, marginBottom: 8,
  },
  tourEditCount: { fontSize: 11, color: COLORS.guide, marginTop: 4, fontWeight: '700' },

  inboxCard: {
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: COLORS.rule, marginBottom: 8,
  },
  inboxTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  inboxAvatar: { fontSize: 36 },
  inboxName: { fontSize: 14, fontWeight: '700', color: COLORS.ink },
  inboxMeta: { fontSize: 12, color: COLORS.inkMuted, marginTop: 2 },
  inboxTourTitle: { fontSize: 13, color: COLORS.inkMuted, marginBottom: 6 },
  inboxNote: { fontSize: 13, color: COLORS.ink, fontStyle: 'italic', backgroundColor: COLORS.bg, padding: 10, borderRadius: 8, marginBottom: 10 },
  inboxActions: { flexDirection: 'row', gap: 8 },
  inboxBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.rule },
  inboxBtnPrimary: { backgroundColor: COLORS.guide, borderColor: COLORS.guide },
  inboxBtnText: { fontSize: 13, fontWeight: '700', color: COLORS.inkMuted },
  inboxBtnTextPrimary: { color: '#fff' },
  inboxCardSmall: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.surface, padding: 10, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.rule, marginBottom: 6,
  },
  inboxAvatarSmall: { fontSize: 22 },
  inboxNameSmall: { fontSize: 13, fontWeight: '600', color: COLORS.ink },
  inboxMetaSmall: { fontSize: 11, color: COLORS.inkSubtle, marginTop: 2 },

  profileTopRow: { flexDirection: 'row', gap: 14, alignItems: 'center', marginBottom: 18 },
  profileAvatarWrap: {
    width: 78, height: 78, borderRadius: 39,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.rule,
    alignItems: 'center', justifyContent: 'center',
  },
  profileAvatar: { fontSize: 44 },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  emojiCell: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.rule,
    alignItems: 'center', justifyContent: 'center',
  },
  emojiCellActive: { borderColor: COLORS.accent, borderWidth: 2 },
  emojiText: { fontSize: 24 },

  fieldLabel: { fontSize: 11, color: COLORS.inkSubtle, letterSpacing: 1.2, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  input: {
    backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, color: COLORS.ink, borderWidth: 1, borderColor: COLORS.rule,
  },
  textarea: { minHeight: 90, paddingTop: 12, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  langChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.rule,
  },
  langChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  langChipText: { fontSize: 12, color: COLORS.inkMuted, fontWeight: '600' },
  langChipTextActive: { color: '#fff' },
  saveBtn: {
    marginTop: 24, backgroundColor: COLORS.accent, paddingVertical: 14, borderRadius: 999, alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 0.3 },

  settingRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: COLORS.surface, paddingHorizontal: 14, paddingVertical: 14,
    borderRadius: 10, borderWidth: 1, borderColor: COLORS.rule,
  },
  settingLabel: { fontSize: 14, color: COLORS.ink, fontWeight: '600' },
  settingValue: { fontSize: 13, color: COLORS.inkMuted },

  demoFootnote: {
    marginTop: 22, padding: 14, borderRadius: 10,
    backgroundColor: COLORS.accentSoft, borderWidth: 1, borderColor: COLORS.accent,
  },
  demoFootnoteHead: { fontSize: 12, fontWeight: '700', color: COLORS.accentDeep, marginBottom: 4, letterSpacing: 0.3 },
  demoFootnoteBody: { fontSize: 12, color: COLORS.accentDeep, lineHeight: 18 },

  colorRow: { flexDirection: 'row', gap: 8 },
  colorSwatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: 'transparent' },
  colorSwatchActive: { borderColor: COLORS.ink },

  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepper: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.rule,
    alignItems: 'center', justifyContent: 'center',
  },
  stepperText: { fontSize: 22, color: COLORS.inkMuted, lineHeight: 22 },
  stepperVal: { fontSize: 18, fontWeight: '700', color: COLORS.ink, minWidth: 36, textAlign: 'center', fontVariant: ['tabular-nums'] },
  stepperLabel: { fontSize: 13, color: COLORS.inkMuted, marginLeft: 6 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(20,16,10,0.55)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: COLORS.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 30,
  },
  modalEyebrow: { fontSize: 11, color: COLORS.accent, letterSpacing: 1.5, fontWeight: '700' },
  modalTitle: { fontSize: 17, fontWeight: '700', color: COLORS.ink, marginTop: 4 },
  modalSub: { fontSize: 12, color: COLORS.inkMuted, marginTop: 2 },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 22 },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.rule },
  modalBtnText: { fontSize: 14, fontWeight: '700', color: COLORS.inkMuted },
  modalBtnPrimary: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  modalBtnTextPrimary: { color: '#fff' },
  modalBtnDanger: { backgroundColor: '#f7e1e1', borderColor: '#f7e1e1' },
  modalBtnTextDanger: { color: COLORS.warn },

  editorHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.rule,
  },
  editorClose: { fontSize: 14, color: COLORS.inkMuted, fontWeight: '600' },
  editorTitle: { fontSize: 15, fontWeight: '700', color: COLORS.ink },
  editorCover: {
    height: 140, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  editorCoverEmoji: { fontSize: 76 },

  deleteBtn: {
    marginTop: 28, paddingVertical: 14, borderRadius: 10, alignItems: 'center',
    backgroundColor: '#f7e1e1',
  },
  deleteBtnText: { color: COLORS.warn, fontSize: 14, fontWeight: '700' },

  // Slot picker in the booking modal
  slotChip: {
    minWidth: 100, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 12, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.rule, alignItems: 'center',
  },
  slotChipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  slotChipDate: { fontSize: 12, color: COLORS.ink, fontWeight: '700' },
  slotChipTime: { fontSize: 11, color: COLORS.inkMuted, marginTop: 2 },
  slotChipTextActive: { color: '#fff' },

  // Slot manager in the editor
  slotList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 8 },
  slotPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingLeft: 10, paddingRight: 6, paddingVertical: 6,
    borderRadius: 999, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.rule,
  },
  slotPillDate: { fontSize: 12, color: COLORS.ink, fontWeight: '700' },
  slotPillTime: { fontSize: 11, color: COLORS.inkMuted },
  slotPillX: {
    fontSize: 18, color: COLORS.inkSubtle, paddingHorizontal: 4, lineHeight: 18,
  },
  slotAddRow: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 6 },
  slotAddBtn: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    backgroundColor: COLORS.guide,
  },
  slotAddBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  bodyMuted: { fontSize: 12, color: COLORS.inkMuted, fontStyle: 'italic', marginTop: 4, marginBottom: 4, lineHeight: 17 },
  subFieldLabel: { fontSize: 10, color: COLORS.inkSubtle, letterSpacing: 1, fontWeight: '700', marginTop: 14, marginBottom: 6 },
  slotClearLink: { fontSize: 11, color: COLORS.warn, fontWeight: '700', letterSpacing: 0.3 },

  weekdayRow: { flexDirection: 'row', gap: 4, marginBottom: 6 },
  weekdayChip: {
    flex: 1, paddingVertical: 8, borderRadius: 8,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.rule,
    alignItems: 'center',
  },
  weekdayChipActive: { backgroundColor: COLORS.guide, borderColor: COLORS.guide },
  weekdayChipText: { fontSize: 11, color: COLORS.inkMuted, fontWeight: '700' },
  weekdayChipTextActive: { color: '#fff' },

  // Itinerary editor (guide side)
  stopRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.rule,
    paddingVertical: 10, paddingHorizontal: 10, marginBottom: 6,
  },
  stopIndex: {
    fontSize: 11, color: COLORS.accent, fontWeight: '800', letterSpacing: 1,
    minWidth: 22, textAlign: 'right',
  },
  stopTitle: { fontSize: 13, color: COLORS.ink, fontWeight: '700' },
  stopNote: { fontSize: 12, color: COLORS.inkMuted, marginTop: 2, lineHeight: 16 },
  stopActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stopArrow: { fontSize: 16, color: COLORS.inkMuted, paddingHorizontal: 2 },
  stopX: { fontSize: 18, color: COLORS.warn, paddingHorizontal: 2, lineHeight: 18 },

  // Itinerary (tourist detail view)
  detailItinRow: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    marginBottom: 10,
  },
  detailItinNum: {
    fontSize: 11, color: COLORS.accent, fontWeight: '800', letterSpacing: 1,
    minWidth: 22, paddingTop: 2,
  },
  detailItinTitle: { fontSize: 14, color: COLORS.ink, fontWeight: '700' },
  detailItinNote: { fontSize: 12, color: COLORS.inkMuted, marginTop: 2, lineHeight: 17 },
});
