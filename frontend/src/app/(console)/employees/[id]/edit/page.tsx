'use client';

import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { Alert, PageHeader } from '@/components/ui';
import { EmployeeForm } from '../../EmployeeForm';

export default function EditEmployeePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  return (
    <>
      <PageHeader
        title="Edit employee"
        sub="Promotions, transfers and resignations are recorded with Life event on the profile, so the history stays complete."
        crumbs={[
          { href: '/employees', label: 'Employees' },
          { href: `/employees/${id}`, label: 'Profile' },
        ]}
      />
      {can('employee.edit') ? <EmployeeForm id={id} /> : <Alert>You do not have permission to edit employees.</Alert>}
    </>
  );
}
