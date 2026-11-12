import { createPolicyPage } from '@/lib/policies/policyPage';

const page = createPolicyPage('privacy');

export const generateMetadata = page.generateMetadata;
export default page.Page;
