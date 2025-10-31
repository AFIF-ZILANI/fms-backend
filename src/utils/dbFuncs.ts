import { prisma } from "./db";
import type { IAdmin, ICustomer, IEmployee, ISupplier } from "@/types";

export async function CreateEmployee(data: IEmployee) {
    if (!data.email || !data.photo) {
        throw Error("Email and Photo is required");
    }
    await prisma.employee
        .create({
            data: {
                name: data.name,
                email: data.email,
                photo: data.photo,
                mobile: data.mobile,
                salary: data.salary,
                join_date: data.joined_date,
                address: data.address,
                role: data.role,
                online_contact: {
                    set: Array.isArray(data.online_contact)
                        ? data.online_contact
                        : [data.online_contact],
                }
            },
        })
        .then((res) => {
            return res;
        })
        .catch((err) => {
            console.log(err);
            throw err;
        })
}

export async function CreateSupplier(data: ISupplier) {
    await prisma.supplier
        .create({
            data: {
                name: data.name,
                email: data.email,
                photo: data.photo,
                mobile: data.mobile,
                address: data.address,
                company: data.company,
                rating: data.rating,
                online_contact: {
                    set: Array.isArray(data.online_contact)
                        ? data.online_contact
                        : [data.online_contact],
                },
                role: data.role,
            },
        })
        .then((res) => {
            return res;
        })
        .catch((err) => {
            console.log(err);
            throw err;
        })
}


export async function CreateCustomer(data:ICustomer){
    await prisma.customer.create({
        data: {
            name: data.name,
            email: data.email,
            mobile:data.mobile,
            address: data.address,
            photo: data.photo,
            company:data.company,
            online_contact: {
                    set: Array.isArray(data.online_contact)
                        ? data.online_contact
                        : [data.online_contact],
                }
        }
    })
}