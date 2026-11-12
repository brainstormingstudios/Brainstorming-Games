import { createListingPage } from '@/lib/catalogue/listingPage';

const page = createListingPage('trending');

export const generateMetadata = page.generateMetadata;
export default page.Page;
