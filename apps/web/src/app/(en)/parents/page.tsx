import { createPolicyPage } from '@/lib/policies/policyPage';

const page = createPolicyPage('parents');

export const generateMetadata = page.generateMetadata;
export default page.Page;
