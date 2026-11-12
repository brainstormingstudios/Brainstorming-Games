import { createPolicyPage } from '@/lib/policies/policyPage';

const page = createPolicyPage('about');

export const generateMetadata = page.generateMetadata;
export default page.Page;
