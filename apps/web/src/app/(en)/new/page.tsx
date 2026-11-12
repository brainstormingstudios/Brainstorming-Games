import { createListingPage } from '@/lib/catalogue/listingPage';

const page = createListingPage('new');

export const generateMetadata = page.generateMetadata;
export default page.Page;
