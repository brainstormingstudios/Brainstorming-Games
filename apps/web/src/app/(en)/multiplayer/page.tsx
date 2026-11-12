import { createListingPage } from '@/lib/catalogue/listingPage';

const page = createListingPage('multiplayer');

export const generateMetadata = page.generateMetadata;
export default page.Page;
