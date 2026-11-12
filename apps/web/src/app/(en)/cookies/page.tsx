import { createPolicyPage } from '@/lib/policies/policyPage';

const page = createPolicyPage('cookies');

export const generateMetadata = page.generateMetadata;
export default page.Page;
